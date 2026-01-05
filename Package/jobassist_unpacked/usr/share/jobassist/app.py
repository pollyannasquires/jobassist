# FILENAME: app.py | LAST EDITED: 2025-10-27 (DictCursor fix)
# FILENAME: app.py | LAST EDITED: 2025-11-17 ( added error logging )
from flask import Flask, g, jsonify, request, send_file, send_from_directory # Added send_from_directory
import psycopg2
import psycopg2.extras # Needed for dictionary cursor
from psycopg2 import sql # <-- CRITICAL: This line is necessary for sql.SQL()
import os
import uuid
from datetime import datetime
from werkzeug.utils import secure_filename
from werkzeug.exceptions import BadRequest # <-- IMPORTANT NEW IMPORT
import io # Used in download_document logic (not strictly needed if using send_file)
import mimetypes # <--- endpoint 9: Required for guess_extension (fixes NameError)
from functools import wraps
import logging
import traceback # <--- CRITICAL FIX 2: Ensure traceback is imported
import sys # <-- NEW: Import sys for robust error logging
from datetime import date
from magic import Magic


app = Flask(__name__)

# --- Database Connection Configuration ---
DB_CONFIG = {
    'dbname': 'contact_db',
    'user': 'jobert',
    'password': 'linkedin',  # CHANGE THIS TO JOBERT'S PASSWORD
    'host': 'localhost'
}
# --- File Upload Configuration (NEW) ---
UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', '/usr/share/jobassist/filestore') 
ALLOWED_MIME_TYPES = {
    'application/pdf', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', # Official DOCX
    'application/zip',                                                         # Common fallback for DOCX (it's a zipped XML format)
    'application/octet-stream'                                                 # Generic binary type (often used when OS can't determine it)
}
# Allowed file extensions and document type mapping
ALLOWED_EXTENSIONS = {'pdf', 'doc', 'docx', 'txt'}
# We map the short code (e.g., 'resume') to the database ENUM value (e.g., 'RESUME')
DOCUMENT_TYPE_MAP = {
    'resume': 'RESUME',
    'cover_letter': 'COVER_LETTER',
    'transcript': 'TRANSCRIPT',
    'recommendation': 'RECOMMENDATION',
    'other': 'OTHER'
}

app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['ALLOWED_MIME_TYPES'] = ALLOWED_MIME_TYPES

# Ensure the upload directory exists
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

## HELPERS
#
# NOTE: Moved here for strict Gunicorn/worker scoping.
# Utility function to check file extension
# ----------------------------------------------------------------------
# HELPER: Get or Create ID (for Company and Job Title)
# ----------------------------------------------------------------------

def get_or_create_id(conn, table_name, column_name, value):
    """
    Checks if a value exists in a lookup table. 
    If it exists, returns the existing ID; otherwise, creates a new entry and returns the new ID.
    """
    cursor = conn.cursor()
    
    # --- FIX: Handle irregular pluralization for 'companies' (company_id) ---
    if table_name == 'companies':
        id_column = 'company_id'
    # --- END FIX ---
    elif table_name.endswith('s'):
        # Handles plurals like job_titles -> job_title_id
        id_column = f"{table_name[:-1]}_id" 
    else:
        # Handles singulars
        id_column = f"{table_name}_id"
    
    # 1. Check if the value exists
    select_query = f"SELECT {id_column} FROM {table_name} WHERE {column_name} = %s"
    cursor.execute(select_query, (value,))
    
    result = cursor.fetchone()
    if result:
        return result[0] # Return existing ID

    # 2. Value does not exist, so insert new record
    insert_query = f"""
        INSERT INTO {table_name} ({column_name}) 
        VALUES (%s) 
        RETURNING {id_column};
    """
    cursor.execute(insert_query, (value,))
    
    new_id = cursor.fetchone()[0]
    conn.commit()
    return new_id

# FIX: Ensure it only takes one argument (filename) to match the call site.
def allowed_file(filename):
    """Checks if the file extension is allowed (PDF or DOCX)."""
    # This is a basic check...
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ['pdf', 'docx']
def _insert_document_metadata(conn, user_id, application_id, secure_filename, original_filename, file_size, mime_type, file_extension):
    """Inserts metadata for a newly uploaded document into the job_documents table."""
    SQL = """
        INSERT INTO job_documents 
        (user_id, application_id, secure_filename, original_filename, file_size, mime_type, file_extension, upload_date)
        VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
        RETURNING document_id;
    """
    try:
        with conn.cursor() as cur:
            cur.execute(SQL, (
                user_id, 
                application_id, 
                secure_filename, 
                original_filename, 
                file_size, 
                mime_type, 
                file_extension
            ))
            conn.commit()
            return cur.fetchone()[0]
    except Exception as e:
        print(f"Error inserting document metadata: {e}")
        conn.rollback()
        raise

def get_db_connection():
    """Returns a connection object."""
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        return conn
    except psycopg2.Error as e:
        print(f"Database connection failed: {e}")
        return None

def get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor):
    """Returns a cursor object with the specified factory."""
    return conn.cursor(cursor_factory=cursor_factory)

def validate_uuid(uuid_string):
    """
    Validates if a string is a valid UUID4.
    Returns True if valid, False otherwise.
    """
    try:
        # Attempt to create a UUID object from the string.
        # This will raise a ValueError if the string is not a valid UUID format.
        uuid.UUID(uuid_string, version=4)
        return True
    except ValueError:
        return False
# --- Helper Functions (for DB Transactions) ---

def check_application_ownership(application_id, user_id):
    """
    NEW HELPER: Checks if the application exists and is owned by the user.
    Returns True if valid, False otherwise.
    """
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        if not conn:
            return False

        cur = conn.cursor()
        cur.execute(
            "SELECT 1 FROM applications WHERE application_id = %s AND user_id = %s",
            (application_id, user_id)
        )
        # If fetchone() is not None, the record exists and is owned by the user.
        return cur.fetchone() is not None

    except psycopg2.Error as e:
        # Log the error but treat it as a failure to find the record for security
        print(f"PostgreSQL Error during ownership check: {getattr(e.diag, 'message_primary', str(e))}")
        return False
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()

# IMPORTANT: Corrected to match the 'job_documents' schema provided by the user.
def save_document_to_db(document_id, application_id, document_type, original_filename, mime_type):
    """Saves the document metadata to the job_documents table."""
    conn = None
    cur = None
    try:
        conn = get_db_connection()
        if not conn:
            raise Exception("Could not connect to database.")

        cur = conn.cursor()

        # Insert the document metadata into the CORRECT table 'job_documents'
        # document_id (UUID) is used for file_path as well
        cur.execute(
            """
            INSERT INTO job_documents 
                (document_id, application_id, document_type, file_path, original_filename, mime_type, upload_timestamp)
            VALUES 
                (%s, %s, %s, %s, %s, %s, NOW())
            """,
            (document_id, application_id, document_type, str(document_id), original_filename, mime_type)
        )

        # Update the application's updated_at timestamp
        cur.execute(
            """
            UPDATE applications SET updated_at = NOW() WHERE application_id = %s
            """,
            (application_id,)
        )

        conn.commit()
        
    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        raise e 
    except Exception as e:
        raise e 
    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()



    # --- Utility Functions ---

def get_document_mime_type(file):
    """
    Determines the MIME type of a Flask FileStorage object, with a fallback
    for common file types like DOCX that might be misidentified as octet-stream
    by the client or OS.
    """
    # 1. Use the MIME type provided by the request/werkzeug
    mime_type = file.mimetype if hasattr(file, 'mimetype') and file.mimetype else None

    # 2. Fallback if MIME type is missing or generic octet-stream
    if not mime_type or mime_type == 'application/octet-stream':
        original_filename = file.filename
        
        # Check common extensions manually for robustness
        if original_filename.lower().endswith('.docx'):
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        elif original_filename.lower().endswith('.pdf'):
            return 'application/pdf'

    # 3. If a valid, non-generic MIME type was found initially, return it
    return mime_type


def get_job_title_id(title_name, conn):
    """Retrieves or creates a job_title record and returns its ID."""
    cur = None
    try:
        cur = conn.cursor()
        # 1. Try to find existing job title
        cur.execute("SELECT job_title_id FROM job_titles WHERE title_name = %s", (title_name,))
        result = cur.fetchone()
        
        if result:
            return result[0]
        
        # 2. Create new job title if not found
        cur.execute(
            "INSERT INTO job_titles (title_name, created_at, updated_at) VALUES (%s, NOW(), NOW()) RETURNING job_title_id",
            (title_name,)
        )
        job_title_id = cur.fetchone()[0]
        conn.commit()
        return job_title_id

    except psycopg2.Error as e:
        # In a transactional function, it's safer to rollback if we run into issues.
        if conn:
            conn.rollback()
        raise e
    finally:
        if cur:
            cur.close()

def get_company_id(company_name_clean, conn):
    """Retrieves or creates a company profile and returns its ID."""
    cur = None
    try:
        cur = conn.cursor()
        # 1. Try to find existing company
        cur.execute("SELECT company_id FROM companies WHERE company_name_clean = %s", (company_name_clean,))
        result = cur.fetchone()

        if result:
            return result[0]

        # 2. Create new company if not found
        # We'll use reasonable defaults for the required fields
        cur.execute(
            """
            INSERT INTO companies 
                (company_name_clean, target_interest, size_employees, annual_revenue, revenue_scale, headquarters, website, user_id, created_at, updated_at)
            VALUES 
                (%s, FALSE, 0, 0.0, 'M', 'Unknown', 'N/A', %s, NOW(), NOW()) 
            RETURNING company_id
            """,
            (company_name_clean, MOCK_USER_ID)
        )
        company_id = cur.fetchone()[0]
        conn.commit()
        return company_id

    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        raise e
    finally:
        if cur:
            cur.close()

# --- AUTHENTICATION HELPER (TEMPORARILY BYPASSED) ---

#
# We define the hardcoded user ID that will be used for all database ownership checks.
# THIS ID MUST MATCH A USER IN THE 'users' TABLE (as verified by the user's DB output).
HARDCODED_USER_ID = '12345678-1234-5678-1234-567812345678'
HARDCODED_USERNAME = 'jobert'

# MOCK_USER_ID is a placeholder for the variable that will eventually hold the REAL user ID
MOCK_USER_ID = HARDCODED_USER_ID 

#
def authenticate_request():
    """
    TEMPORARY AUTH BYPASS: Unconditionally sets a dummy user in the global 'g' object.
    It sets g.user_id, which is the correct variable to use in all endpoints.
    """
    def wrapper(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            # Set the mock user ID in Flask's global request context
            g.user_id = MOCK_USER_ID # <-- ALL ENDPOINTS MUST USE g.user_id or MOCK_USER_ID
            g.username = HARDCODED_USERNAME
            return f(*args, **kwargs)
        return decorated
    return wrapper

# <--- IMPORTANT: The 'def requires_auth' line MUST start here, 
# at the same level as 'def authenticate_request'
def requires_auth(f):
    """
    A custom decorator that ensures the request is 'authenticated'.
    Since authenticate_request is currently bypassed, this decorator 
    simply ensures g.user is populated with the 'jobert' payload.
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        # The authentication is now a guaranteed success in development mode
        authenticate_request() 
        
        # We skip the failure check because authenticate_request never fails 
        # in this temporary setup.
        return f(*args, **kwargs)
    return decorated
# --- END OF CORRECTED AUTHENTICATION BLOCK ---

@app.route('/api/db_test', methods=['GET'])
def db_test():
    """Checks database connection health."""
    conn = None
    try:
        # CRITICAL LINE: Check the DB connection credentials/config here.
        conn = get_db_connection() 
        
        # If connection succeeds, execute a simple query
        cur = conn.cursor()
        cur.execute('SELECT 1;')
        cur.fetchone()
        
        # If all succeeds, close and report success.
        conn.close() 
        print("[LOG] DB Connection Test: SUCCESS")
        return jsonify({"status": "success", "message": "Database connection and simple query successful!"})
    except Exception as e:
        # If the failure is here, this print statement MUST show up.
        print(f"[LOG] DB Connection Test FAILED: {e}") 
        import traceback
        traceback.print_exc()
        if conn: conn.close()
        return jsonify({"status": "error", "message": f"DB Connection Failed. Check server logs."}), 500
# --- API Endpoints ---

@app.route('/')
def index():
    # Simple endpoint for health check
    return "JobAssist Backend is running."


# ----------------------------------------------------------------------
# 1. GET ALL COMPANIES (Dashboard List View) - Handles /api/companies (NO ID)
# UPDATE: Added user-specific application count and global contact count.
# ----------------------------------------------------------------------
@app.route('/api/companies', methods=['GET'])
@authenticate_request() # REQUIRED for user-specific data (application_count)
def get_companies():
    """
    Endpoint 1.0: Retrieves all standardized company profiles, 
    including user-specific application count and global contact count for the dashboard view.
    """
    user_id = g.user_id # Get the authenticated user ID
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Select key fields and include subqueries for counts
        sql = """
            SELECT 
                c.company_id, 
                c.company_name_clean, 
                c.headquarters, 
                c.size_employees, 
                c.target_interest, 
                c.annual_revenue,
                
                -- 1. Get total applications for this company by the authenticated user
                (
                    SELECT COUNT(a.application_id)
                    FROM applications a
                    WHERE a.company_id = c.company_id
                    AND a.user_id = %s 
                ) AS application_count,
                
                -- 2. Get total contacts associated with this company (globally/across all users).
                -- NOTE: The 'contacts' table currently lacks a 'user_id' column, so this count is global.
                (
                    SELECT COUNT(t1.id)
                    FROM contacts t1
                    JOIN company_name_mapping t2 ON t1.company = t2.raw_name
                    WHERE t2.company_id = c.company_id
                ) AS contact_count
                
            FROM companies c
            ORDER BY c.company_name_clean;
        """
        # Execute the query, passing user_id for the application count subquery
        cur.execute(sql, (user_id,))
        
        # Convert DictRow objects to standard dictionaries for JSON serialization
        # and ensure counts are explicitly integers
        companies_data = []
        for row in cur.fetchall():
            data = dict(row)
            data['application_count'] = int(data.get('application_count', 0))
            data['contact_count'] = int(data.get('contact_count', 0))
            companies_data.append(data)
        
        return jsonify({
            "status": "success",
            "companies": companies_data
        }), 200

    except psycopg2.Error as e:
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in get_companies: {db_error_detail}")
        return jsonify({"status": "error", "message": "Database error retrieving company list."}), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"General Error in get_companies: {e}")
        return jsonify({"status": "error", "message": "Processing error retrieving company list."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 2. GET NEXT COMPANY (Used by Data Standardization Workflow)
# ----------------------------------------------------------------------
@app.route('/api/next_company', methods=['GET'])
def get_next_company():
    """Retrieves the next company that needs standardization (where company_id is NULL in company_name_mapping)."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # SQL to find the first company_name_mapping record where company_id is NULL
        # This means the raw name has not yet been standardized/linked.
        sql = """
            SELECT cnm.raw_name_id, cnm.raw_name, c.company_id
            FROM company_name_mapping cnm
            LEFT JOIN companies c ON cnm.company_id = c.company_id
            WHERE cnm.company_id IS NULL 
            ORDER BY cnm.raw_name_id
            LIMIT 1;
        """
        cur.execute(sql)
        next_company = cur.fetchone()
        
        if next_company:
            # We return the raw name details for the standardization step
            return jsonify({
                "status": "success",
                "raw_name_id": next_company['raw_name_id'],
                "raw_name": next_company['raw_name']
            })
        else:
            return jsonify({
                "status": "success",
                "message": "No more companies require standardization."
            }), 200 # Return 200 with a message, not 404

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in get_next_company: {getattr(e.diag, 'message_primary', 'N/A')}")
        return jsonify({"status": "error", "message": "Database error loading next company."}), 500
    except Exception as e:
        print(f"General Error in get_next_company: {e}")
        return jsonify({"status": "error", "message": "Processing error loading next company."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 3. COMPANY UPDATE API: PUT /api/companies/<int:company_id>
# FIX: REMOVED REFERENCE TO "updated_by_user_id" from the SQL query.
# ----------------------------------------------------------------------
# ----------------------------------------------------------------------
# 3. GET SINGLE COMPANY PROFILE (Detail View) - /api/companies/<int:company_id> GET
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>', methods=['GET'])
def get_company_profile(company_id):
    """Retrieves a single company profile by its integer ID."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # SQL to retrieve a single company profile by its ID
        cur.execute(
            """
            SELECT company_id, company_name_clean, target_interest, size_employees, annual_revenue, revenue_scale, headquarters, notes 
            FROM companies 
            WHERE company_id = %s;
            """,
            (company_id,)
        )
        company = cur.fetchone()

        if company is None:
            # Return 404 if the company is not found
            return jsonify({"status": "error", "message": f"Company ID {company_id} not found."}), 404

        # Convert DictRow to a standard dictionary for JSON serialization
        company_dict = dict(company)

        return jsonify({
            "status": "success", 
            "company": company_dict
        }), 200

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in get_company_profile: {getattr(e.diag, 'message_primary', 'N/A')}")
        # This handles the database error reported by the user
        return jsonify({"status": "error", "message": "Database error retrieving profile."}), 500

    except Exception as e:
        print(f"General Error in get_company_profile: {e}")
        return jsonify({"status": "error", "message": "Processing error retrieving profile."}), 500

    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 4. UPDATE SINGLE COMPANY PROFILE (Management View) - /api/companies/<int:company_id> PUT
# FIX: Standardized DB access to resolve connection/cursor argument errors.
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>', methods=['PUT'])
@authenticate_request()
def update_company(company_id):
    """Endpoint 4.0: Updates an existing company's standardization and details, including notes."""
    data = request.get_json()
    conn = None
    cur = None

    # 1. Input Validation (Ensure at least the key identifier is present)
    if 'company_name_clean' not in data:
        return jsonify({
            "status": "error",
            "message": "Missing required field: company_name_clean"
        }), 400

    # 2. Extract all updatable fields, now including 'notes'
    company_name_clean = data.get('company_name_clean')
    headquarters = data.get('headquarters')
    size_employees = data.get('size_employees')
    annual_revenue = data.get('annual_revenue')
    revenue_scale = data.get('revenue_scale')
    target_interest = data.get('target_interest', False)
    # NEW: Extract the notes field. Use None if not present in payload.
    notes = data.get('notes') 
    
    try:
        # 3. CRITICAL FIX: Use the standardized two-step connection pattern
        conn = get_db_connection()
        if conn is None:
            return jsonify({"status": "error", "message": "Database connection failed."}), 500
            
        # Call the standardized function, passing the required 'conn' argument
        cur = get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor)
        # END CRITICAL FIX

        # 4. Database Update
        sql_update = """
            UPDATE companies SET
                company_name_clean = %s,
                headquarters = %s,
                size_employees = %s,
                annual_revenue = %s,
                revenue_scale = %s,
                target_interest = %s,
                notes = %s  -- NEW: Added notes column
            WHERE company_id = %s;
        """
        # Ensure the order of parameters matches the SQL statement above
        cur.execute(sql_update, (
            company_name_clean, 
            headquarters, 
            size_employees, 
            annual_revenue, 
            revenue_scale, 
            target_interest, 
            notes,            # NEW: Inserted notes parameter
            company_id
        ))
        conn.commit()

        # 5. Success Response
        return jsonify({
            "status": "success",
            "message": f"Company ID {company_id} updated successfully.",
            "company_id": company_id
        }), 200

    except psycopg2.Error as e:
        if conn: conn.rollback()
        error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in update_company: {error_detail}")
        return jsonify({"status": "error", "message": f"Database error: {error_detail}"}), 500
        
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error in update_company: {e}")
        return jsonify({"status": "error", "message": "Processing error during company update."}), 500

    finally:
        if cur: cur.close()
        if conn: conn.close()# --- MOCK AUTHENTICATION DECORATOR ---
def mock_auth_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        g.user_id = MOCK_USER_ID
        if 'Authorization' not in request.headers or not request.headers['Authorization'].startswith('Bearer '):
            return jsonify({"status": "error", "message": "Authentication required."}), 401
        return f(*args, **kwargs)
    return decorated_function

# ======================================================================
# 5. GET RAW NAMES MAPPED TO SINGLE COMPANY - /api/companies/<int:company_id>/raw_names
# (REMOVED MANUAL conn.close())
# ======================================================================
@app.route('/api/companies/<int:company_id>/raw_names', methods=['GET'])
@mock_auth_required
def get_mapped_raw_names(company_id):
    """
    Retrieves all raw company names that have been standardized (mapped)
    to the given clean company profile ID.
    """
    conn = None
    try:
        # 1. Input Validation
        if company_id <= 0:
            return jsonify({"status": "error", "message": "Invalid company ID format."}), 400
        
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # 2. Check if the target company_id actually exists
        cur.execute("SELECT company_id FROM companies WHERE company_id = %s;", (company_id,))
        if cur.fetchone() is None:
            return jsonify({"status": "error", "message": f"Company profile with ID {company_id} not found."}), 404
        
        # 3. Fetch all raw names mapped to this clean company profile
        query = """
        SELECT 
            cnm.raw_name 
        FROM 
            company_name_mapping cnm
        WHERE 
            cnm.company_id = %s
        ORDER BY
            cnm.raw_name ASC;
        """
        
        cur.execute(query, (company_id,))
        
        raw_names = [row['raw_name'] for row in cur.fetchall()]

        # 4. Return results.
        return jsonify({
            "status": "success",
            "company_id": company_id,
            "message": f"Retrieved {len(raw_names)} raw names mapped to company {company_id}.",
            "raw_names": raw_names
        }), 200

    except psycopg2.Error as e:
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in get_mapped_raw_names: {db_error_detail}")
        return jsonify({"status": "error", "message": f"Database error during raw name retrieval: {db_error_detail}"}), 500
        
    except Exception as e:
        print(f"General Error in get_mapped_raw_names: {e}")
        return jsonify({"status": "error", "message": "Processing error during raw name retrieval."}), 500

    # Removed the manual 'finally: conn.close()' block
# ----------------------------------------------------------------------
# 6. MAP RAW NAME TO EXISTING COMPANY (Standardization Action)
# ----------------------------------------------------------------------
@app.route('/api/map/existing', methods=['POST'])
@mock_auth_required
def map_to_existing():
    """
    Maps a raw company name (string PK) to an existing company_id.
    
    Expected JSON Payload:
    {
        "raw_name": "Google Inc",
        "company_id": 12345
    }
    """
    data = request.get_json()
    # Expect 'raw_name' string, which is the Primary Key of the mapping table
    raw_name = data.get('raw_name')
    company_id = data.get('company_id')

    if raw_name is None or company_id is None:
        return jsonify({"status": "error", "message": "raw_name (string) and company_id (integer) are required."}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Update the company_name_mapping record for the given raw_name.
        # It links the raw_name to the standardized company_id.
        sql = """
            UPDATE company_name_mapping
            SET company_id = %s
            WHERE raw_name = %s 
              AND company_id IS NULL; -- Only map unmapped records
        """
        # Use raw_name as the primary key/identifier
        cur.execute(sql, (company_id, raw_name))

        if cur.rowcount == 0:
             # This happens if the raw_name doesn't exist or is already mapped
             return jsonify({
                "status": "error", 
                "message": "Mapping not updated. Raw Name not found or already mapped."
            }), 404
        
        conn.commit()

        return jsonify({
            "status": "success",
            "message": f"Raw name '{raw_name}' successfully mapped to existing Company ID {company_id}."
        }), 200

    except psycopg2.Error as e:
        if conn: conn.rollback()
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in map_to_existing: {db_error_detail}")
        return jsonify({"status": "error", "message": "Database error during map to existing."}), 500
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error in map_to_existing: {e}")
        return jsonify({"status": "error", "message": "Processing error during map to existing."}), 500
    finally:
        if conn: conn.close()
# ----------------------------------------------------------------------
# 7. MAP RAW NAME TO NEW COMPANY (Standardization Action)
# ----------------------------------------------------------------------
@app.route('/api/map/new', methods=['POST'])
@mock_auth_required
def map_to_new():
    """
    Creates a brand new company profile and maps the specific raw_name (string PK) to it.

    Expected JSON Payload:
    {
        "raw_name": "Googel, Inc.",
        "company_name_clean": "Google"
    }
    """
    data = request.get_json()
    raw_name = data.get('raw_name')
    company_name_clean = data.get('company_name_clean')

    if raw_name is None or company_name_clean is None:
        return jsonify({"status": "error", "message": "raw_name (string) and company_name_clean are required."}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # 1. Create the new company profile using company_name_clean
        # FIX: We now ONLY insert the 'company_name_clean' field because 
        # the current database schema for 'companies' does not include 'user_id' or 'created_at'.
        sql_insert_company = """
            INSERT INTO companies (company_name_clean)
            VALUES (%s)
            RETURNING company_id;
        """
        # Execute the insert with only the clean name
        cur.execute(sql_insert_company, (company_name_clean,))
        new_company_id = cur.fetchone()[0]
        
        # 2. Update mapping using the raw_name string key
        # This links the old raw name to the new company profile
        sql_update_mapping = """
            UPDATE company_name_mapping
            SET company_id = %s
            WHERE raw_name = %s AND company_id IS NULL;
        """
        cur.execute(sql_update_mapping, (new_company_id, raw_name))

        if cur.rowcount == 0:
            # If nothing was updated, we roll back the company creation
            conn.rollback()
            # It's highly likely the raw_name doesn't exist unmapped if rowcount is 0
            return jsonify({
                "status": "error", 
                "message": "Mapping not updated. Raw Name not found or already mapped. The new company was not created."
            }), 404

        conn.commit()

        return jsonify({
            "status": "success",
            "message": f"New company ID {new_company_id} created ('{company_name_clean}') and raw name '{raw_name}' mapped successfully."
        }), 201

    except psycopg2.Error as e:
        if conn: conn.rollback()
        # Log the specific SQL error details
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in map_to_new: {db_error_detail}") 
        return jsonify({"status": "error", "message": "Database error during map to new."}), 500
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error in map_to_new: {e}")
        return jsonify({"status": "error", "message": "Processing error during map to new."}), 500
    finally:
        if conn: conn.close()
        
def execute_mapping_transaction(raw_name, clean_name, target_interest):
    """
    Helper function to handle the complex database logic for mapping a raw name 
    to a standardized (clean) company profile. This logic is fully transactional.

    The steps are:
    1. Check if the raw_name is already mapped (return 409 if true).
    2. Find or create the standardized company profile (Upsert logic).
    3. Insert the new mapping record.
    """
    conn = None
    cur = None
    
    print(f"DEBUG 8.0: Starting mapping transaction for raw_name: '{raw_name}' -> clean_name: '{clean_name}'")

    try:
        # Establish connection
        conn = get_db_connection()
        if conn is None:
            return {"status": "error", "message": "Database connection failed."}, 500
        
        # Get the Cursor (Using the DictCursor is highly recommended for clarity, 
        # but the original used a default cursor for fetchone()[0])
        # We will stick to the default cursor as per the original file's implementation 
        # in the helper, but use DictCursor in the main endpoint for consistency.
        cur = conn.cursor()
        
        # Ensure the transaction is atomic
        conn.autocommit = False

        # 1. Check if raw_name is already mapped
        sql_check = "SELECT company_id FROM company_name_mapping WHERE raw_name = %s;"
        cur.execute(sql_check, (raw_name,))
        if cur.fetchone():
            conn.rollback()
            return {"status": "error", "message": f"Raw name '{raw_name}' is already mapped."}, 409

        # 2. Find or create the standardized company profile (Upsert logic)
        
        # Try to find existing company_id for the clean_name
        sql_find_company = "SELECT company_id FROM companies WHERE company_name_clean = %s;"
        cur.execute(sql_find_company, (clean_name,))
        company_row = cur.fetchone()
        
        if company_row:
            # Company exists, use its ID
            company_id = company_row[0]
            action = "reused"
            print(f"DEBUG 8.0: Found existing company ID: {company_id}")
            
            # Optional: Update target_interest if it was set to False and the new map suggests True
            sql_update_target = "UPDATE companies SET target_interest = %s WHERE company_id = %s AND target_interest = FALSE;"
            cur.execute(sql_update_target, (target_interest, company_id))
        else:
            # Company does not exist, create a new profile
            sql_create_company = """
                INSERT INTO companies 
                    (company_name_clean, target_interest, notes)
                VALUES 
                    (%s, %s, %s) 
                RETURNING company_id;
            """
            # Notes is initialized to NULL/None for new creation
            cur.execute(sql_create_company, (clean_name, target_interest, None))
            company_id = cur.fetchone()[0]
            action = "created"
            print(f"DEBUG 8.0: Created new company ID: {company_id}")


        # 3. Insert the new mapping record
        mapping_id = str(uuid.uuid4()) # Generate a UUID for the mapping ID if the table uses one
        sql_insert_mapping = """
            INSERT INTO company_name_mapping 
                (mapping_id, raw_name, company_id, date_mapped)
            VALUES 
                (%s, %s, %s, NOW());
        """
        cur.execute(sql_insert_mapping, (mapping_id, raw_name, company_id))

        # 4. Commit the transaction
        conn.commit()
        print(f"DEBUG 8.0: Transaction committed successfully. Action: {action}, Mapping ID: {mapping_id}")

        return {
            "status": "success", 
            "message": f"Mapping successful. Company {action}: {company_id}.",
            "company_id": company_id,
            "raw_name": raw_name,
            "clean_name": clean_name
        }, 200

    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in execute_mapping_transaction for raw name '{raw_name}': {db_error_detail}")
        traceback.print_exc()
        return {"status": "error", "message": f"Database error during mapping transaction: {db_error_detail}"}, 500
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"General Error in execute_mapping_transaction for raw name '{raw_name}': {e}")
        traceback.print_exc()
        return {"status": "error", "message": "Processing error during mapping transaction."}, 500
    finally:
        if conn:
            conn.autocommit = True
            if cur: cur.close()
            conn.close()


# ----------------------------------------------------------------------
# 8. MAP RAW NAME TO SELF (Standardization Action)
# POST /api/map/self
# ----------------------------------------------------------------------
@app.route('/api/map/self', methods=['POST'])
@authenticate_request()
def map_to_self():
    """
    Endpoint 8.0: Cleanup Action 3: Use the raw name as the clean name and map 
    to it (flagged as TARGET by default).
    """
    data = request.get_json()
    raw_name = data.get('raw_name')
    
    # 1. Input Validation
    if not raw_name:
        return jsonify({"status": "error", "message": "raw_name is required."}), 400

    # 2. Set parameters for self-map: clean_name is the raw_name, and target_interest is TRUE by default
    target_interest = True 
    response_data, status_code = execute_mapping_transaction(raw_name, raw_name, target_interest)
    
    # 3. Customize success message for the self-map endpoint
    if status_code == 200 and response_data.get("status") == "success":
         response_data["message"] = f"'{raw_name}' self-mapped and flagged as a target company. Company ID: {response_data['company_id']}"
    
    return jsonify(response_data), status_code# ----------------------------------------------------------------------
# 9. DOCUMENT UPLOAD API: POST /api/application/<uuid:application_id>/documents
# FIX: Using standardized two-step database access (get_db_connection then get_db_cursor(conn, ...))
# ----------------------------------------------------------------------
## ENDPOINT 9.0: Upload Document
@app.route('/api/application/<uuid:application_id>/documents', methods=['POST'])
@authenticate_request()
def upload_document(application_id):
    conn = None
    cur = None
    save_path = None
    
    # 1. Input Validation and Accessing Auth User
    user_id = g.user_id 
    application_id_str = str(application_id)
    
    print(f"--- DEBUG 9.0 START ---")
    print(f"User ID: {user_id}")
    print(f"Application ID (string): {application_id_str}")

    # --- REQUIRED FIELD: document_type ---
    document_type = request.form.get('document_type')
    
    if not document_type:
         return jsonify({"status": "error", "message": "Missing required field: document_type"}), 400

    # Safety check: Ensure the provided document_type is a valid ENUM value
    document_type_upper = document_type.upper()
    if document_type_upper not in ['RESUME', 'COVER_LETTER', 'JOB_DESCRIPTION', 'CERTIFICATE', 'OTHER']:
         return jsonify({"status": "error", "message": f"Invalid document_type: {document_type}. Must be a valid ENUM value."}), 400

    # 3. File Handling and Saving
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "Missing file part in request."}), 400

    uploaded_file = request.files['file']
    if uploaded_file.filename == '':
        return jsonify({"status": "error", "message": "No selected file."}), 400

    original_filename = secure_filename(uploaded_file.filename)
    # Generate UUID for the document ID and filename on disk
    file_uuid = str(uuid.uuid4())
    
    # Use the UUID as the unique filename on the disk (this is the value for file_path)
    save_path = os.path.join(UPLOAD_FOLDER, file_uuid)
    
    try:
        # Save the file to the file system
        uploaded_file.save(save_path)
        print(f"DEBUG 9.0: File saved to disk: {save_path}")

        # Determine Mime Type using python-magic (Assumed to be imported)
        mime_type = Magic(mime=True).from_file(save_path)
        print(f"DEBUG 9.0: Mime Type determined: {mime_type}")

        # 4. Database Insertion
        # *** CRITICAL FIX: Use the standardized two-step connection pattern ***
        conn = get_db_connection()
        if conn is None:
            # If the connection fails, raise an exception to jump to the cleanup/error block
            raise Exception("Failed to establish database connection.")
            
        # Call the standardized function, passing the required 'conn' argument
        cur = get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor)
        # *** END CRITICAL FIX ***

        # SQL Query based STRICTLY on the provided schema:
        sql_query = """
            INSERT INTO job_documents (
                document_id,            -- PK is explicitly inserted (UUID)
                application_id, 
                document_type, 
                original_filename, 
                file_path,              -- Matches schema (filename on disk = file_uuid)
                mime_type, 
                upload_timestamp        -- Matches schema
            ) 
            VALUES (%s, %s, %s, %s, %s, %s, NOW()) 
            RETURNING document_id
            """
        
        # Parameters for the 6 placeholders (%s)
        cur.execute(
            sql_query,
            (file_uuid, application_id_str, document_type_upper, original_filename, file_uuid, mime_type) 
        )
        new_document_id = cur.fetchone()[0]
        conn.commit()
        print(f"DEBUG 9.0: Document metadata saved to DB: {new_document_id}")

        return jsonify({
            "status": "success", 
            "message": "Document uploaded successfully.", 
            "document_id": str(new_document_id)
        }), 201

    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        # Clean up file if database insert fails
        if save_path and os.path.exists(save_path):
             os.remove(save_path)
        # Extract specific DB error detail
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in upload_document: {e}") 
        return jsonify({"status": "error", "message": f"Database error during document save: {db_error_detail}"}), 500
        
    except Exception as e:
        # Catch file system errors or other exceptions
        print(f"General Error in upload_document: {e}")
        error_detail = str(e)
        # Attempt to clean up the file if it was saved before the exception
        if save_path and os.path.exists(save_path):
             os.remove(save_path)
        return jsonify({"status": "error", "message": "Processing error during file upload.", "detail": error_detail}), 500
        
    finally:
        if cur: cur.close()
        if conn: conn.close()
# ----------------------------------------------------------------------
# 10. APPLICATION CREATION API: POST /api/application
# ----------------------------------------------------------------------

# 10.0 POST /api/applications (Application Creation)
# ----------------------------------------------------------------------
@app.route('/api/applications', methods=['POST'])
def create_application():
    """Endpoint 10: Creates a new job application, ensuring company and job title lookups are handled first."""
    data = request.get_json()
    
    # 1. Validate mandatory input
    required_fields = ['company_name_clean', 'title_name', 'date_applied', 'current_status']
    if not all(field in data for field in required_fields):
        return jsonify({"status": "error", "message": "Missing required fields: company_name_clean, title_name, date_applied, current_status."}), 400

    company_name_clean = data['company_name_clean']
    title_name = data['title_name']
    date_applied_str = data['date_applied'] 
    current_status = data['current_status']

    # 1.1. Crucial Date Validation and Standardization
    try:
        # Assuming frontend sends in ISO 8601 format (YYYY-MM-DD)
        parsed_date = datetime.strptime(date_applied_str, '%Y-%m-%d').date()
        date_applied_sql = parsed_date.isoformat() # Format for SQL insertion
    except ValueError:
        return jsonify({
            "status": "error", 
            "message": f"Invalid date format for 'date_applied'. Expected YYYY-MM-DD, received '{date_applied_str}'."
        }), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Helper function to find or create ID in lookup tables
        def find_or_create_lookup(table_name, name_column, name_value):
            # Explicitly define ID column name based on table_name to avoid pluralization error
            if table_name == 'companies':
                id_column = 'company_id'
            elif table_name == 'job_titles':
                id_column = 'job_title_id'
            else:
                # Should not happen in this context, but good practice
                raise ValueError(f"Unsupported lookup table: {table_name}")

            # 1. Check if name exists
            sql_select = f"SELECT {id_column} FROM {table_name} WHERE {name_column} = %s;"
            cur.execute(sql_select, (name_value,))
            result = cur.fetchone()
            
            if result:
                return result[0]
            
            # 2. If not found, insert new name
            sql_insert = f"""
                INSERT INTO {table_name} ({name_column})
                VALUES (%s)
                ON CONFLICT ({name_column}) DO NOTHING
                RETURNING {id_column};
            """
            cur.execute(sql_insert, (name_value,))
            new_id = cur.fetchone()
            
            if new_id:
                return new_id[0]
            else:
                # If ON CONFLICT DO NOTHING ran (i.e., another transaction committed first), fetch the existing ID again
                cur.execute(sql_select, (name_value,))
                # Ensure we handle the case where the record might still not exist (e.g., if the unique index is missing)
                final_id = cur.fetchone()
                if final_id:
                     return final_id[0]
                else:
                    raise psycopg2.Error(f"Failed to find or create record in {table_name}")

        # 2. Get/Create Company ID
        company_id = find_or_create_lookup('companies', 'company_name_clean', company_name_clean)
        
        # 3. Get/Create Job Title ID
        job_title_id = find_or_create_lookup('job_titles', 'title_name', title_name)
        
        # 4. Insert into applications table
        sql_insert_app = """
            INSERT INTO applications (user_id, company_id, job_title_id, date_applied, current_status)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING application_id;
        """
        # We use date_applied_sql (the correctly formatted string) here
        cur.execute(sql_insert_app, (MOCK_USER_ID, company_id, job_title_id, date_applied_sql, current_status))
        application_id = cur.fetchone()[0]

        conn.commit()
        
        return jsonify({
            "status": "success",
            "message": "Application created successfully.",
            "application_id": str(application_id) # Cast UUID to string
        }), 201

    except psycopg2.Error as e:
        if conn: conn.rollback()
        # Log the specific PostgreSQL error for the backend team
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in create_application: {db_error_detail}") 
        # Return the specific detail to the user to help debug from the frontend console
        return jsonify({"status": "error", "message": f"Database error during application creation: {db_error_detail}"}), 500
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error in create_application: {e}")
        return jsonify({"status": "error", "message": "Processing error during application creation."}), 500
    finally:
        if conn:
            conn.close()
# ----------------------------------------------------------------------
# 11. APPLICATION AGGREGATE API: GET /api/applications?company_id=<int>
# ----------------------------------------------------------------------
@app.route('/api/applications', methods=['GET'])
def get_applications_by_company():
    """
    Retrieves all applications, job titles, and nested documents for a given company_id and MOCK_USER_ID.
    """
    # company_id is expected as an integer query parameter
    company_id = request.args.get('company_id', type=int)

    if not company_id:
        return jsonify({"status": "error", "message": "Missing required query parameter: company_id."}), 400

    conn = None
    try:
        conn = get_db_connection()
        # Use DictCursor for easy access to column names
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        sql_query = """
            SELECT
                a.application_id,
                a.date_applied,
                a.current_status,
                jt.job_title_id,
                jt.title_name,
                c.company_id,
                c.company_name_clean,
                jd.document_id,
                jd.document_type,
                jd.file_path,
                jd.original_filename
            FROM applications a
            LEFT JOIN job_titles jt ON a.job_title_id = jt.job_title_id
            LEFT JOIN job_documents jd ON a.application_id = jd.application_id
            LEFT JOIN companies c ON a.company_id = c.company_id
            -- Enforce user authentication using MOCK_USER_ID
            WHERE a.company_id = %s AND a.user_id = %s
            ORDER BY a.date_applied DESC, a.application_id;
        """
        cur.execute(sql_query, (company_id, MOCK_USER_ID))
        records = cur.fetchall()

        if not records:
            # If no records exist for the company/user combo, return empty list
            return jsonify({"status": "success", "applications": []}), 200

        # --- Data Restructuring Logic ---
        applications_map = {}
        company_info = None # Capture company info from the first record

        for record in records:
            app_id = str(record['application_id'])

            if not company_info:
                company_info = {
                    "company_id": record['company_id'],
                    "company_name_clean": record['company_name_clean']
                }

            if app_id not in applications_map:
                # Initialize new application record
                applications_map[app_id] = {
                    "application_id": app_id,
                    "date_applied": str(record['date_applied']),
                    "current_status": record['current_status'],
                    "company_info": company_info,
                    "job_title_info": {
                        "job_title_id": record['job_title_id'],
                        "title_name": record['title_name']
                    },
                    "documents": []
                }

            # Add document if it exists (check for NULL document_id due to LEFT JOIN)
            if record['document_id'] is not None:
                applications_map[app_id]['documents'].append({
                    "document_id": str(record['document_id']),
                    "document_type": record['document_type'],
                    "file_path": record['file_path'], # This is the secure filename
                    "original_filename": record['original_filename']
                })
        
        # Convert the dictionary values (applications) back into a list
        final_response = list(applications_map.values())
        
        return jsonify({"status": "success", "applications": final_response}), 200

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in get_applications_by_company: {e.diag.message_primary}")
        return jsonify({"status": "error", "message": "Database error retrieving applications."}), 500
    except Exception as e:
        print(f"General Error in get_applications_by_company: {e}")
        return jsonify({"status": "error", "message": "Processing error retrieving applications."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 24. DOCUMENTS AGGREGATE API: GET /api/documents/all (FIXED SCHEMA)
# ----------------------------------------------------------------------
@app.route('/api/documents/all', methods=['GET'])
@authenticate_request() 
def get_all_documents():
    """
    Endpoint 24.0: Retrieves a list of all job documents for the authenticated user.
    """
    user_id = g.user_id
    conn = None
    
    app.logger.info(f"START: get_all_documents for User ID: {user_id}")
    
    try:
        conn = get_db_connection()
        if conn is None:
            app.logger.error(f"FATAL: No DB connection for get_all_documents (User: {user_id})")
            return jsonify({"status": "error", "message": "Database connection failed."}), 503

        cur = get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor)
        
        sql_query = """
            SELECT
                jd.document_id,
                jd.application_id,
                jd.document_type,
                jd.original_filename,
                jd.file_path, -- The secure filename on disk
                -- FIX: Changed 'jd.upload_date' to the correct column name 'jd.upload_timestamp'
                jd.upload_timestamp, 
                
                -- Company Info (via applications join)
                a.company_id,
                c.company_name_clean
                
            FROM job_documents jd
            JOIN applications a ON jd.application_id = a.application_id
            JOIN companies c ON a.company_id = c.company_id
            -- CRITICAL SECURITY FILTER
            WHERE a.user_id = %s
            -- FIX: Changed 'jd.upload_date' to the correct column name 'jd.upload_timestamp'
            ORDER BY jd.upload_timestamp DESC; 
        """
        cur.execute(sql_query, (user_id,))
        
        documents_data = []
        for row in cur.fetchall():
            data = dict(row)
            
            # Convert Python date/datetime objects to ISO string format for JSON
            # FIX: Check for the correct column key 'upload_timestamp'
            timestamp_value = data.get('upload_timestamp')
            if isinstance(timestamp_value, (date, datetime)):
                data['upload_timestamp'] = timestamp_value.isoformat()
            
            documents_data.append(data)
        
        app.logger.info(f"SUCCESS: Retrieved {len(documents_data)} documents for User ID: {user_id}")
        
        return jsonify({
            "status": "success",
            "documents": documents_data
        }), 200

    except psycopg2.Error as e:
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        # Log the specific PostgreSQL error details
        app.logger.error(f"POSTGRESQL ERROR in get_all_documents (User: {user_id}): {db_error_detail}")
        return jsonify({"status": "error", "message": "Database error retrieving documents list."}), 500
    
    except Exception as e:
        # Log the full traceback for unexpected errors
        app.logger.error(f"GENERAL ERROR in get_all_documents (User: {user_id}): {e}")
        traceback.print_exc() # Prints to stdout/stderr, often captured by Gunicorn
        return jsonify({"status": "error", "message": "Processing error retrieving documents list."}), 500
    
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 12. DOCUMENT DOWNLOAD API: GET /api/documents/<string:file_path>
# FIX: Using standardized two-step database access to resolve 'Processing error'.
# ----------------------------------------------------------------------

@app.route('/api/documents/<string:file_path>', methods=['GET'])
@authenticate_request()
def download_document(file_path):
    """
    Endpoint 12: Downloads a document using its secure filename (which is now document_id).
    Requires ownership check before serving the file from disk.
    """
    conn = None
    cur = None
    
    # 1. Input Validation and Accessing Auth User
    user_id = g.user_id 
    document_id = file_path # The file_path here is the secure document_id (UUID)

    print(f"--- DEBUG 12.0 START: Document ID: {document_id} ---")
    
    try:
        # 1. Database Connection (Standardized two-step process)
        conn = get_db_connection()
        if conn is None:
             return jsonify({"status": "error", "message": "Database connection failed"}), 500
             
        # Call the standardized function, passing the required 'conn' argument
        cur = get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor)

        # 2. Security Check: Retrieve Document Metadata and Verify Ownership
        # We join job_documents with applications to ensure the document belongs to an application owned by the user.
        sql_check = """
            SELECT jd.original_filename
            FROM job_documents jd
            JOIN applications a ON jd.application_id = a.application_id
            WHERE jd.document_id = %s AND a.user_id = %s
            """
        
        cur.execute(sql_check, (document_id, user_id))
        document_data = cur.fetchone()

        if not document_data:
            # Document not found, or it is not owned by the authenticated user
            print(f"DEBUG 12.0: Document {document_id} not found or ownership failed for user {user_id}.")
            return jsonify({"status": "error", "message": "File not found or unauthorized access."}), 404
        
        original_filename = document_data[0]
        print(f"DEBUG 12.0: Document ownership verified. Original filename: {original_filename}")

        # 3. Serve the file securely using Flask's send_from_directory
        # Check if file exists on disk before serving (Crucial for FileNotFoundError handling)
        full_path = os.path.join(app.config['UPLOAD_FOLDER'], document_id)
        if not os.path.exists(full_path):
             # Explicitly raise FileNotFoundError if the file is missing from disk
             raise FileNotFoundError(f"File {document_id} is missing on disk.")

        return send_from_directory(
            app.config['UPLOAD_FOLDER'], 
            document_id, # This is the secure filename on disk
            as_attachment=True, # Forces a download dialog
            download_name=original_filename # Uses the user's original file name
        )

    except psycopg2.Error as e:
        if conn: conn.rollback()
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in download_document: {db_error_detail}")
        return jsonify({"status": "error", "message": f"Database error during ownership check: {db_error_detail}"}), 500
        
    except FileNotFoundError:
        # This occurs if the database record exists, but the file is missing on disk
        print(f"File not found on disk for Document ID: {document_id}")
        return jsonify({"status": "error", "message": "Document record found, but file is missing on the server."}), 500
        
    except Exception as e:
        print(f"General Error in download_document: {e}")
        # The generic error message now includes a print of the exception for server-side debugging
        return jsonify({"status": "error", "message": "Processing error during file download."}), 500

    finally:
        if cur: cur.close()
        if conn: conn.close()# ----------------------------------------------------------------------
# 13. GET COMPANY CONTACTS API: GET /api/companies/<int:company_id>/contacts
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>/contacts', methods=['GET'])
@authenticate_request()
def get_company_contacts(company_id):
    """
    Endpoint 13: Retrieves all contacts mapped to the given standardized company_id.
    FIXED: Corrected database connection/cursor acquisition to prevent NoneType error.
    """
    user_id = g.user_id
    conn = None
    
    print(f"--- DEBUG 13.0 START: Retrieving contacts for Company ID: {company_id} ---")

    try:
        if company_id <= 0:
            return jsonify({"status": "error", "message": "Invalid company ID format."}), 400

        # --- Connection Setup FIX: Use two-step process ---
        conn = get_db_connection()
        if conn is None:
            # FIX: Return early if connection fails, preventing the AttributeError
            return jsonify({"status": "error", "message": "Database connection failed."}), 500
        
        # Now conn is guaranteed not to be None, so we can safely get the cursor
        cur = get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor)
        # -------------------------------------------------


        # CORRECTED SQL QUERY:
        # - Selects t1.id and aliases it to contact_id.
        # - Filters by company_id.
        sql_query = """
        SELECT
            t1.id AS contact_id,
            t1.first_name,
            t1.last_name,
            t1.email_address,
            t1.position,
            t1.connected_on,
            t1.url as linkedIn_url,
            t2.raw_name AS associated_raw_name
        FROM contacts t1
        JOIN company_name_mapping t2 ON t1.company = t2.raw_name
        WHERE t2.company_id = %s;
        """
        
        # We only pass company_id to the execute method now.
        cur.execute(sql_query, (company_id,))
        
        # Convert DictRow objects to standard dictionaries for JSON serialization
        contacts = [dict(row) for row in cur.fetchall()]

        print(f"DEBUG 13.0: Retrieved {len(contacts)} contacts for company {company_id}.")

        # Success Response
        return jsonify({
            "status": "success",
            "company_id": company_id,
            "contacts": contacts
        }), 200

    except psycopg2.Error as e:
        if conn: conn.rollback()
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"\n[CRITICAL DB ERROR IN GET /api/companies/contacts (Endpoint 13.0)]:") 
        print(f"DETAIL: {db_error_detail}\n") 
        return jsonify({"status": "error", "message": f"Database error retrieving contacts: {db_error_detail}"}), 500
        
    except Exception as e:
        if conn: conn.rollback()
        import traceback
        traceback.print_exc()
        print(f"General Error in get_company_contacts: {e}")
        return jsonify({"status": "error", "message": "An unexpected server error occurred."}), 500

    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 14. SIDEBAR SUMMARY API: GET /api/sidebar
# FIX: Removed WHERE clause as 'companies' is a global table.
# ----------------------------------------------------------------------
@app.route('/api/sidebar', methods=['GET'])
@requires_auth
def get_sidebar_summary():
    """
    Retrieves a minimal list of companies for UI elements like the sidebar.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # FIX: Query is corrected to retrieve all companies since the 'companies' table 
        # is a global standardized list and lacks a user_id filter column.
        sql_query = """
            SELECT
                company_id,
                company_name_clean,
                target_interest AS is_target
            FROM
                companies
            ORDER BY
                company_name_clean ASC;
        """
        
        # Execute query without any parameters
        cur.execute(sql_query)
        
        # Fetch all results and convert DictRows to standard dictionaries
        companies_summary = [dict(row) for row in cur.fetchall()]

        # Return the summary list
        return jsonify({
            "status": "success", 
            "companies": companies_summary
        }), 200

    except psycopg2.Error as e:
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in get_sidebar_summary: {db_error_detail}")
        return jsonify({"status": "error", "message": "Database error retrieving sidebar data."}), 500
        
    except Exception as e:
        print(f"General Error in get_sidebar_summary: {e}")
        return jsonify({"status": "error", "message": "Processing error retrieving sidebar data."}), 500
        
    finally:
        if conn:
            pass
# ----------------------------------------------------------------------
# 15. GET FULL LIST OF UNMAPPED COMPANY NAMES (For the Skip/List View)
#    *** FIX: Now returns raw_name (string) instead of raw_name_id (int) as the unique key ***
# ----------------------------------------------------------------------
@app.route('/api/unmapped_list', methods=['GET'])
@mock_auth_required
def get_unmapped_list():
    """
    Retrieves a list of all company names not yet mapped. Since the database 
    PK is the raw_name string, we return it as the identifier.
    """
    conn = None
    try:
        conn = get_db_connection()
        # Use a DictCursor to get results as dictionaries
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # Query the company_name_mapping table directly for unmapped records
        # CRITICAL FIX: Only select raw_name, since it is the primary key/identifier
        sql = """
            SELECT 
                raw_name
            FROM 
                company_name_mapping
            WHERE 
                company_id IS NULL
            ORDER BY
                raw_name;
        """

        cur.execute(sql)
        
        # Results is now an array of objects/strings, but we'll return an array of objects 
        # for consistency with the spirit of the API Change Request, using 'raw_name' 
        # as the key/identifier.
        results = [{'raw_name': row['raw_name']} for row in cur.fetchall()]

        return jsonify({"status": "success", "raw_names": results}), 200

    except psycopg2.Error as e:
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in get_unmapped_list: {db_error_detail}")
        return jsonify({"status": "error", "message": "Database error retrieving unmapped list."}), 500
    except Exception as e:
        print(f"General Error in get_unmapped_list: {e}")
        return jsonify({"status": "error", "message": "Processing error retrieving unmapped list."}), 500
    finally:
        if cur: cur.close()
        if conn: conn.close()
# --- API ENDPOINT 16.0: COMPANY PROFILE SEARCH ---

@app.route('/api/search/company', methods=['GET'])
@mock_auth_required
def search_company_profiles():
    """
    16.0 GET /api/search/company
    Provides real-time, debounced search suggestions for existing, standardized company profiles.
    """
    query = request.args.get('query', '').strip()

    # --- Parameter Validation ---
    if not query:
        return jsonify({
            "status": "error",
            "message": "Missing 'query' parameter."
        }), 400

    if len(query) < 2:
        return jsonify({
            "status": "error",
            "message": "Query must be at least 2 characters long."
        }), 400

    conn = None
    try:
        conn = get_db_connection()
        
        if conn is None:
            return jsonify({
                "status": "error",
                "message": "Could not connect to database. Check DB settings and availability in the server console."
            }), 500

        # We must use DictCursor for the named parameter execution to work seamlessly.
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # CRITICAL FIX: Using named parameters (%(name)s) instead of positional parameters (%s) 
        # to guarantee the parameter count and assignment is correct, eliminating the IndexEror.
        sql = """
            SELECT
                company_id,
                company_name_clean
            FROM
                companies
            WHERE
                -- Filter by anything that contains the query
                company_name_clean ILIKE %(query_broad)s
            ORDER BY
                -- Priority 1: Exact Match
                CASE WHEN company_name_clean ILIKE %(query_exact)s THEN 1 
                -- Priority 2: Prefix Match
                     WHEN company_name_clean ILIKE %(query_prefix)s THEN 2
                -- Priority 3: Contains Match (this ensures all WHERE results are captured in ORDER BY)
                     WHEN company_name_clean ILIKE %(query_broad)s THEN 3
                     ELSE 4 END, 
                -- Final alphabetical sort
                company_name_clean
            LIMIT 10;
        """
        
        # Prepare parameters as a dictionary (keys must match the %(name)s placeholders)
        params_dict = {
            'query_exact': query,         # 'microsoft'
            'query_prefix': f'{query}%',  # 'microsoft%'
            'query_broad': f'%{query}%',   # '%microsoft%'
        }

        # Execute the query using the dictionary of named parameters
        cur.execute(sql, params_dict)
        results = cur.fetchall()

        companies = []
        for row in results:
            companies.append({
                "company_id": str(row['company_id']), 
                "company_name_clean": row['company_name_clean']
            })

        return jsonify({
            "status": "success",
            "companies": companies
        }), 200

    except EnvironmentError as e:
        return jsonify({
            "status": "error", 
            "message": f"Server Configuration Error: {e}"
        }), 500

    except psycopg2.Error as e:
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        # Log to stderr for robust logging
        print(f"❌ PostgreSQL Query/Execution Error in search_company_profiles: {db_error_detail}", file=sys.stderr)
        if conn: conn.rollback()
        return jsonify({
            "status": "error", 
            "message": "A database query error occurred during search. Check server logs for detail."
        }), 500
    
    except Exception as e:
        # Log the full traceback to stderr
        print(f"❌ General Error in search_company_profiles: {e}", file=sys.stderr)
        print(traceback.format_exc(), file=sys.stderr) 
        if conn: conn.rollback()
        return jsonify({
            "status": "error", 
            "message": "An unexpected server error occurred. Check server logs for stack trace."
        }), 500
    
    finally:
        if conn:
            conn.close()

# --- Helper Function to Clean String Inputs (Must be defined outside the route) ---
def clean_string_input(value):
    """
    Converts incoming empty strings (or strings containing only whitespace) 
    to None, ensuring they are stored as NULL in the database.
    """
    if isinstance(value, str) and value.strip() == "":
        return None
    return value

# ----------------------------------------------------------------------
# 17. POST /api/companies (Create New Company Profile)
# ----------------------------------------------------------------------
@app.route('/api/companies', methods=['POST'])
@mock_auth_required 
def create_new_company_profile(): 
    """
    Creates a new company profile, expecting the documented FLAT JSON payload 
    and ensuring all empty optional fields are converted to NULL before insertion.
    """
    conn = None
    try:
        # Step 1: Parse the incoming JSON payload.
        # This is the line that will throw a BadRequest if the client sends an empty body 
        # but claims Content-Type: application/json.
        data = request.get_json(silent=False) 
        
        if not data:
            return jsonify({"status": "error", "message": "Request body must be valid JSON and cannot be empty (or check Content-Type header). "}), 400

        # --- REQUIRED FIELD CHECK ---
        company_name_clean = data.get('company_name_clean')
        if not company_name_clean:
            return jsonify({"status": "error", "message": "The field 'company_name_clean' is required."}), 400

        # --- Data Extraction and Alignment ---
        
        # 1. Boolean field
        target_interest = data.get('is_target', False) 
        
        # 2. Numeric fields (handled for None/null)
        size_employees = data.get('size_employees')
        annual_revenue = data.get('annual_revenue')

        size_employees_final = int(size_employees) if size_employees is not None else None
        annual_revenue_final = float(annual_revenue) if annual_revenue is not None else None
        
        # 3. String fields: APPLY CLEAN-UP FUNCTION
        headquarters = clean_string_input(data.get('headquarters'))
        revenue_scale = clean_string_input(data.get('revenue_scale'))
        notes = clean_string_input(data.get('notes'))
        
        # 4. Database Connection and Execution 
        conn = get_db_connection()
        cur = conn.cursor()

        sql = """
            INSERT INTO companies (
                company_name_clean, target_interest, size_employees, 
                annual_revenue, headquarters, notes, revenue_scale
            ) VALUES (
                %s, %s, %s, %s, %s, %s, %s
            ) RETURNING company_id;
        """
        
        cur.execute(sql, (
            company_name_clean, 
            target_interest, 
            size_employees_final, 
            annual_revenue_final, 
            headquarters, 
            notes, 
            revenue_scale
        ))
        
        new_company_id = cur.fetchone()[0]
        
        conn.commit()

        return jsonify({
            "status": "success",
            "message": "Company profile created successfully.",
            "company_id": new_company_id
        }), 201

    except BadRequest as e:
        # Catches the JSON parsing failure or empty body
        print(f"[CLIENT ERROR] Bad Request (JSON Parse Fail): {e}")
        return jsonify({"status": "error", "message": "Invalid JSON format or empty request body. Ensure Content-Type is 'application/json' and the body is valid."}), 400

    except psycopg2.Error as e:
        if conn: conn.rollback()
        # Catches the DB constraint violation (the likely original 500 error)
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"[DB ERROR] in create_new_company_profile: {db_error_detail}") 
        return jsonify({"status": "error", "message": "Database error creating company profile. Check constraints."}), 500
        
    except Exception as e:
        if conn: conn.rollback()
        import traceback
        traceback.print_exc()
        print(f"[GENERAL ERROR] in create_new_company_profile: {e}") 
        return jsonify({"status": "error", "message": "An unexpected server error occurred."}), 500
        
    finally:
        if conn: conn.close()
# ----------------------------------------------------------------------
# 18. DELETE COMPANY PROFILE (Soft Delete: Nullify FKs, then Delete)
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>', methods=['DELETE'])
@mock_auth_required
def soft_delete_company_profile(company_id):
    """
    Performs a soft delete on a company profile:
    1. Nullifies company_id in related tables (company_name_mapping, applications).
    2. Deletes the company record from the 'companies' table.
    
    Returns HTTP 204 No Content on success.
    """
    conn = None
    try:
        conn = get_db_connection()
        if not conn:
            # Handles the scenario where the database connection fails immediately
            raise Exception("Database connection failed.")
            
        cur = conn.cursor()

        # Start Transaction: crucial for ensuring all three steps succeed or fail together
        conn.autocommit = False

        # --- Action 1: UPDATE company_name_mapping (Set FK to NULL) ---
        # Disassociate raw names from the company profile to preserve historical raw data.
        sql_map_nullify = """
            UPDATE company_name_mapping
            SET company_id = NULL
            WHERE company_id = %s;
        """
        cur.execute(sql_map_nullify, (company_id,))


        # --- Action 2: UPDATE applications (Set FK to NULL) ---
        # Disassociate application records from the company profile to preserve job history.
        # The 'applications' table is included as per the new spec requirements.
        sql_app_nullify = """
            UPDATE applications
            SET company_id = NULL
            WHERE company_id = %s;
        """
        cur.execute(sql_app_nullify, (company_id,))

        
        # --- Action 3: DELETE from companies table ---
        # The actual deletion of the standardized profile record.
        sql_delete_company = """
            DELETE FROM companies
            WHERE company_id = %s;
        """
        cur.execute(sql_delete_company, (company_id,))
        
        # Check if the company record was deleted
        if cur.rowcount == 0:
            conn.rollback()
            # If nothing was deleted, the ID didn't exist (404 Not Found)
            return jsonify({
                "status": "error",
                "message": f"Company profile {company_id} not found or already deleted."
            }), 404

        # Commit Transaction: All three steps succeeded
        conn.commit()

        # Success: HTTP 204 No Content
        return '', 204

    except psycopg2.Error as e:
        if conn: conn.rollback()
        # Extract primary error message for better logging
        db_error_detail = getattr(e.diag, 'message_primary', 'A database error occurred.')
        print(f"PostgreSQL Error in soft_delete_company_profile: {db_error_detail}")
        return jsonify({
            "status": "error", 
            "message": "A database error occurred during the soft deletion process."
        }), 500
        
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error in soft_delete_company_profile: {e}")
        return jsonify({
            "status": "error", 
            "message": "An unexpected error occurred during profile disassociation."
        }), 500
        
    finally:
        # Clean up connection state and close it
        if conn:
            conn.autocommit = True
            conn.close()
# --- Helper Functions ---

def get_or_create_job_title(cur, title_name: str) -> int:
    """
    Looks up or creates a job title globally by name.
    
    Args:
        cur: The psycopg2 database cursor.
        title_name: The raw job title string.

    Returns:
        The job_title_id (integer) of the existing or newly created job title.
    """
    # 1. Look up the job title based ONLY on the title_name (Global lookup, case insensitive)
    sql_check = "SELECT job_title_id FROM job_titles WHERE lower(title_name) = lower(%s)"
    cur.execute(sql_check, (title_name,))
    
    result = cur.fetchone()
    if result:
        return result[0]

    # 2. Job title not found, so create a new one
    now = datetime.now()
    
    # Standardized_title is set to title_name as a default placeholder
    sql_insert = """
        INSERT INTO job_titles (title_name, standardized_title, created_at, updated_at)
        VALUES (%s, %s, %s, %s)
        RETURNING job_title_id
    """
    
    # NOTE: No company_id is passed or used here.
    cur.execute(sql_insert, (title_name, title_name, now, now))
    
    new_job_title_id = cur.fetchone()[0]
    return new_job_title_id

def check_company_exists(cur, company_id):
    """Checks if a company_id exists."""
    sql_check = "SELECT company_id FROM companies WHERE company_id = %s;"
    cur.execute(sql_check, (company_id,))
    return cur.fetchone() is not None


# ----------------------------------------------------------------------
# 19. APPLICATION UPDATE API: PUT /api/applications/<uuid:application_id>
# ----------------------------------------------------------------------
@app.route('/api/applications/<uuid:application_id>', methods=['PUT'])
@authenticate_request()
def update_application_19(application_id):
    """
    Endpoint 19.0: Updates an existing job application.
    FIXED: Corrected database connection/cursor acquisition to prevent NoneType error.
    """
    user_id = g.user_id
    conn = None
    application_id_str = str(application_id)

    print(f"--- DEBUG 19.0 START: Updating Application ID: {application_id_str} for User: {user_id} ---")

    try:
        # 1. Get JSON data
        data = request.get_json(silent=False)
        if not data:
            raise BadRequest("Request body must be valid JSON and cannot be empty.")

        # --- Connection Setup FIX: Check for failed connection immediately ---
        conn = get_db_connection()
        if conn is None:
            # FIX: Return early if connection fails, preventing the AttributeError
            return jsonify({"status": "error", "message": "Database connection failed."}), 500
        
        # Now conn is guaranteed not to be None, so we can safely get the cursor
        cur = get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor)
        # ----------------------------

        # 2. Data Validation and Pre-processing
        current_status = data.get('current_status')
        date_applied_str = data.get('date_applied')
        title_name = data.get('title_name')
        company_id = data.get('company_id')
        company_name_clean = data.get('company_name_clean') 

        if not all([current_status, date_applied_str, title_name, company_id]):
            return jsonify({"status": "error", "message": "Missing required fields: current_status, date_applied, title_name, company_id."}), 400

        # Date validation
        try:
            # Attempt to parse date in YYYY-MM-DD format
            date_applied_sql = datetime.strptime(date_applied_str, '%Y-%m-%d').date().isoformat()
        except ValueError:
            return jsonify({"status": "error", "message": "Invalid date format for 'date_applied'. Expected YYYY-MM-DD."}), 400

        # Company ID validation
        try:
            company_id_int = int(company_id)
        except ValueError:
            return jsonify({"status": "error", "message": "'company_id' must be an integer string."}), 400

        # Check if the company_id exists
        if not check_company_exists(cur, company_id_int):
             return jsonify({"status": "error", "message": f"Company ID {company_id_int} does not exist in the database."}), 404
        
        # 3. Get or Create Job Title
        job_title_id = get_or_create_job_title(cur, title_name)

        # 4. Update the Application Record (Requires ownership check)
        sql_update = """
            UPDATE applications
            SET
                company_id = %s,
                job_title_id = %s,
                date_applied = %s,
                current_status = %s,
                updated_at = NOW()
            WHERE application_id = %s AND user_id = %s
            RETURNING application_id;
        """
        
        cur.execute(sql_update, (
            company_id_int,
            job_title_id,
            date_applied_sql,
            current_status,
            application_id_str,
            user_id
        ))
        
        # 5. Commit and Check Result
        conn.commit()

        # Check if any row was actually updated
        if cur.rowcount == 0:
             # Application not found or does not belong to the user
             return jsonify({"status": "error", "message": f"Application ID {application_id_str} not found or does not belong to the user."}), 404


        print(f"DEBUG 19.0: Application {application_id_str} updated successfully.")
        
        # 6. Success Response
        return jsonify({
            "status": "success",
            "message": f"Application {application_id_str} updated successfully."
        }), 200 # Using 200 OK for a successful resource update

    except BadRequest as e:
        if conn: conn.rollback()
        print(f"[CLIENT ERROR] Bad Request: {e}")
        return jsonify({"status": "error", "message": str(e)}), 400

    except psycopg2.Error as e:
        if conn: conn.rollback()
        # CRITICAL: This extracts the specific error message from PostgreSQL
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"\n[CRITICAL DB ERROR IN PUT /api/applications (Endpoint 19.0)]:") 
        print(f"SQLSTATE: {getattr(e.diag, 'sqlstate', 'N/A')}")
        print(f"DETAIL: {db_error_detail}\n") 
        
        # Return the specific detail to the user to help debug
        return jsonify({
            "status": "error", 
            "message": "Database error during application update.",
            "detail": db_error_detail
        }), 500
        
    except Exception as e:
        if conn: conn.rollback()
        traceback.print_exc()
        print(f"[GENERAL ERROR] in update_application_19: {e}")
        return jsonify({"status": "error", "message": "An unexpected server error occurred."}), 500

    finally:
        if conn:
            conn.close()


# ----------------------------------------------------------------------
# 20. DELETE /api/applications/{application_id} (Delete Application)
# ----------------------------------------------------------------------
@app.route('/api/applications/<uuid:application_id>', methods=['DELETE'])
@mock_auth_required
def delete_application(application_id):
    """
    Endpoint 20: Permanently deletes a job application, its document metadata, 
    and all associated physical files from the UPLOAD_FOLDER.
    """
    user_id = g.user_id
    application_id_str = str(application_id)
    conn = None
    cur = None
    files_deleted_count = 0

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Ownership Check and Document Retrieval
        # We need the document_id (which serves as the secure filename) to delete the physical files.
        sql_select_documents = """
            SELECT jd.document_id 
            FROM applications a
            LEFT JOIN job_documents jd ON a.application_id = jd.application_id
            WHERE a.application_id = %s AND a.user_id = %s;
        """
        cur.execute(sql_select_documents, (application_id_str, user_id))
        document_records = cur.fetchall()
        
        # Check for existence/ownership before proceeding with deletions
        if not document_records and cur.rowcount == 0:
            # Check if application exists (by attempting to fetch the main app record)
            cur.execute("SELECT user_id FROM applications WHERE application_id = %s;", (application_id_str,))
            app_owner_record = cur.fetchone()
            
            if not app_owner_record:
                conn.close()
                return jsonify({"status": "error", "message": f"Application {application_id_str} not found."}), 404
            
            if app_owner_record[0] != user_id:
                conn.close()
                return jsonify({"status": "error", "message": "Unauthorized access. This application does not belong to your account."}), 403
            
            # If the app exists but has no documents, we continue to step 4 (delete application record).

        # 2. Delete Physical Files (CRITICAL ACTION)
        for record in document_records:
            document_id = str(record[0]) # document_id is the secure filename
            file_to_delete = os.path.join(UPLOAD_FOLDER, document_id)
            
            try:
                if os.path.exists(file_to_delete):
                    os.remove(file_to_delete)
                    files_deleted_count += 1
                else:
                    # Log a warning but proceed with DB cleanup
                    print(f"WARNING 20.0: File not found on disk: {file_to_delete}")
            except Exception as file_e:
                print(f"FILE SYSTEM ERROR 20.0: Could not delete file {file_to_delete}: {file_e}")
                # Log the error but continue DB cleanup, as the file may be externally locked

        # 3. Delete linked records from job_documents
        sql_delete_docs = """
            DELETE FROM job_documents
            WHERE application_id = %s;
        """
        cur.execute(sql_delete_docs, (application_id_str,))

        # 4. Delete the application record (user_id ensures ownership check)
        sql_delete_app = """
            DELETE FROM applications
            WHERE application_id = %s AND user_id = %s;
        """
        cur.execute(sql_delete_app, (application_id_str, user_id))

        if cur.rowcount == 0 and files_deleted_count == 0:
            # Redundant check, but ensures if no records were touched (after prior checks), we fail
            conn.rollback()
            return jsonify({"status": "error", "message": f"Application {application_id_str} not found or unauthorized."}), 404
        
        # 5. Commit the transaction
        conn.commit()

        return jsonify({
            "status": "success",
            "message": f"Application {application_id_str} deleted successfully. {files_deleted_count} associated file(s) removed."
        }), 200

    except psycopg2.Error as e:
        if conn: conn.rollback()
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in delete_application: {db_error_detail}")
        return jsonify({"status": "error", "message": "Database error during application deletion."}), 500
    except Exception as e:
        if conn: conn.rollback()
        traceback.print_exc()
        print(f"General Error in delete_application: {e}")
        # Return the generic server error message as specified in the docs.
        return jsonify({"status": "error", "message": "An unexpected server error occurred during deletion."}), 500
    finally:
        if cur: cur.close()
        if conn: conn.close()
# ----------------------------------------------------------------------
# 21. GET /api/application/<uuid:application_id> (Retrieve Single Application)
# ----------------------------------------------------------------------
# FIX: Using the correct singular path '/api/application' with the UUID converter
@app.route('/api/application/<uuid:application_id>', methods=['GET'])
@mock_auth_required
def get_single_application(application_id):
    """
    Endpoint 21: Retrieves all stored data for a single job application identified by its UUID.
    This includes nested company, job title, and document information.
    """
    # The user ID is set by the authentication decorator
    user_id = g.user_id 
    application_id_str = str(application_id)
    conn = None
    cur = None
    
    try:
        # The database connection is likely where the error is occurring if the SQL is valid.
        conn = get_db_connection() 
        # Use DictCursor for easy access to column names
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # SQL query confirmed valid via psql test
        sql_query = """
            SELECT
                a.application_id,
                a.user_id,
                a.date_applied,
                a.current_status,
                
                jt.job_title_id,
                jt.title_name,
                
                c.company_id,
                c.company_name_clean,
                
                jd.document_id,
                jd.document_type,
                jd.original_filename
            FROM applications a
            LEFT JOIN job_titles jt ON a.job_title_id = jt.job_title_id
            LEFT JOIN companies c ON a.company_id = c.company_id
            LEFT JOIN job_documents jd ON a.application_id = jd.application_id
            WHERE a.application_id = %s AND a.user_id = %s;
        """
        cur.execute(sql_query, (application_id_str, user_id))
        records = cur.fetchall()

        if not records:
            # Check for 403/404 based on ownership/existence
            cur_check = conn.cursor()
            cur_check.execute("SELECT user_id FROM applications WHERE application_id = %s;", (application_id_str,))
            app_owner_record = cur_check.fetchone()
            cur_check.close()
            
            if app_owner_record:
                # Application exists but user ID does not match the owner
                return jsonify({"status": "error", "message": "Unauthorized access. This application does not belong to your account."}), 403
            else:
                # Application ID does not exist
                return jsonify({"status": "error", "message": f"Application {application_id_str} not found."}), 404

        # 1. Aggregate documents and extract the primary application record
        app_record = records[0]
        documents = []
        for record in records:
            if record['document_id'] is not None:
                documents.append({
                    "document_id": str(record['document_id']),
                    "document_type": record['document_type'],
                    "original_filename": record['original_filename']
                })
        
        # 2. Format date (handling None safely, though the database suggests it's present)
        date_applied_str = app_record['date_applied'].isoformat() if app_record['date_applied'] else None
        
        # 3. Structure the final response object
        application = {
            "application_id": str(app_record['application_id']),
            "user_id": app_record['user_id'],
            "date_applied": date_applied_str,
            "current_status": app_record['current_status'],
            "job_posting_url": None, # Set to None, as it was not in the SELECT list
            "company_info": {
                "company_id": app_record['company_id'],
                "company_name_clean": app_record['company_name_clean']
            } if app_record['company_id'] else None,
            "job_title_info": {
                "job_title_id": app_record['job_title_id'],
                "title_name": app_record['title_name']
            } if app_record['job_title_id'] else None,
            "documents": documents
        }

        return jsonify({"status": "success", "application": application}), 200

    except psycopg2.Error as e:
        # Log the specific psycopg2 error message to help debug connection/transaction issues
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error (psycopg2) in get_single_application: {db_error_detail}. Full Error: {e}")
        # Return generic 500
        return jsonify({"status": "error", "message": "Database error retrieving application details."}), 500
    except Exception as e:
        traceback.print_exc()
        print(f"General Error in get_single_application: {e}")
        return jsonify({"status": "error", "message": "An unexpected server error occurred."}), 500
    finally:
        if cur: cur.close()
        # CRITICAL: Always close the connection
        if conn: conn.close()
        # ----------------------------------------------------------------------
# 22. APPLICATION AGGREGATE API: GET /api/applications/all (FIXED)
# UPDATE: Added contact_count for the associated company.
# ----------------------------------------------------------------------
@app.route('/api/applications/all', methods=['GET'])
@authenticate_request()
def get_all_user_applications():
    """
    Endpoint 22.0: Retrieves a complete, aggregated list of all job applications
    for the authenticated user, including nested document information and 
    the total contact count for the associated company.
    """
    user_id = g.user_id
    conn = None

    print(f"--- DEBUG 22.0 START: Retrieving all applications for User ID: {user_id} ---")

    try:
        conn = get_db_connection()
        if conn is None:
            return jsonify({"status": "error", "message": "Database connection failed."}), 500

        # Use the explicit keyword argument
        cur = get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor)

        # SQL Query to JOIN applications with job_titles, companies, and 
        # a subquery to COUNT the contacts for the company.
        sql_query = """
            SELECT
                a.application_id,
                a.date_applied,
                a.current_status,
                jt.job_title_id,
                jt.title_name,
                c.company_name_clean,
                c.company_id,
                jd.document_id,
                jd.document_type,
                jd.file_path,
                jd.original_filename,
                -- NEW: Subquery to count the number of contacts associated with the company_id
                (
                    SELECT COUNT(t1.id)
                    FROM contacts t1
                    JOIN company_name_mapping t2 ON t1.company = t2.raw_name
                    WHERE t2.company_id = c.company_id
                ) AS contact_count
            FROM applications a
            LEFT JOIN job_titles jt ON a.job_title_id = jt.job_title_id
            LEFT JOIN companies c ON a.company_id = c.company_id
            LEFT JOIN job_documents jd ON a.application_id = jd.application_id
            WHERE a.user_id = %s
            ORDER BY a.date_applied DESC;
        """

        cur.execute(sql_query, (user_id,))
        records = cur.fetchall()

        # Group records by application_id since there will be duplicate rows for each document
        applications_map = {}
        for record in records:
            app_id = str(record['application_id'])
            
            # Application-level data (only needs to be added once)
            if app_id not in applications_map:
                # Convert DictRow to standard dict and ensure type safety for JSON
                app_data = dict(record)

                # Explicitly cast UUID and Date objects to strings
                app_data['application_id'] = app_id
                if isinstance(app_data['date_applied'], date):
                    app_data['date_applied'] = app_data['date_applied'].isoformat()
                
                # Use 'Unknown' for company_id if the join failed (LEFT JOIN)
                if app_data['company_id'] is None:
                    app_data['company_name_clean'] = 'Unknown/Unstandardized Company'
                    app_data['contact_count'] = 0 # No company, no contacts

                # Initialize documents list
                app_data['documents'] = []
                # Ensure contact_count is an integer
                app_data['contact_count'] = int(app_data['contact_count'])

                applications_map[app_id] = app_data
            
            # Document-level data (append only if document_id is not null)
            if record['document_id']:
                doc_id_str = str(record['document_id'])
                
                # Prevent duplicate documents if the same document_id is in the same list 
                # (although the query structure should mostly prevent this, it's safer)
                is_duplicate = any(doc_id_str == str(d['document_id']) for d in applications_map[app_id]['documents'])

                if not is_duplicate:
                    applications_map[app_id]['documents'].append({
                        "document_id": doc_id_str,
                        "document_type": record['document_type'],
                        "file_path": record['file_path'], # Secure filename
                        "original_filename": record['original_filename']
                    })

        # Convert the dictionary values (applications) back into a final response list
        applications_list = list(applications_map.values())

        print(f"DEBUG 22.0: Successfully retrieved {len(applications_list)} applications with documents and contact count.")

        return jsonify({
            "status": "success",
            "applications": applications_list
        }), 200

    except psycopg2.Error as e:
        # This block now captures the specific schema/SQL error
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"[DB ERROR] PostgreSQL Error in get_all_user_applications: {db_error_detail}")
        return jsonify({"status": "error", "message": "Database error retrieving applications."}), 500

    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[GENERAL ERROR] in get_all_user_applications: {e}")
        return jsonify({"status": "error", "message": "An unexpected server error occurred."}), 500

    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 23. CONTACTS AGGREGATE API: GET /api/contacts/all
# ----------------------------------------------------------------------
@app.route('/api/contacts/all', methods=['GET'])
@authenticate_request() 
def get_all_contacts():
    """
    Endpoint 23.0: Retrieves a list of all contacts, enriching them with 
    standardized company_id and company_name_clean via the mapping table.
    NOTE: Data is GLOBAL as the contacts table currently lacks a user_id.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # This query performs the complex three-table join: contacts -> mapping -> companies
        sql_query = """
            SELECT
                t1.id AS contact_id,
                t1.first_name,
                t1.last_name,
                t1.url,
                t1.email_address,
                t1.company AS raw_company_name, -- Original name from contacts table
                t1.position,
                t1.connected_on,
                
                -- Standardized Company Info (via joins)
                t3.company_id,
                t3.company_name_clean
                
            FROM contacts t1
            LEFT JOIN company_name_mapping t2 ON t1.company = t2.raw_name
            LEFT JOIN companies t3 ON t2.company_id = t3.company_id
            ORDER BY t1.last_name, t1.first_name;
        """
        cur.execute(sql_query)
        
        contacts_data = []
        for row in cur.fetchall():
            data = dict(row)
            
            # Convert Python date objects to ISO string format for JSON
            if isinstance(data.get('connected_on'), date):
                data['connected_on'] = data['connected_on'].isoformat()
            
            contacts_data.append(data)
        
        return jsonify({
            "status": "success",
            "contacts": contacts_data
        }), 200

    except psycopg2.Error as e:
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in get_all_contacts: {db_error_detail}")
        return jsonify({"status": "error", "message": "Database error retrieving contacts list."}), 500
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"General Error in get_all_contacts: {e}")
        return jsonify({"status": "error", "message": "Processing error retrieving contacts list."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 25. DOCUMENT DELETION API: DELETE /api/documents/<string:document_id>
# FIX: Adjusted the database connection flow to explicitly call get_db_connection() 
# before calling get_db_cursor(), matching the pattern used in other working endpoints.
# ----------------------------------------------------------------------
@app.route('/api/documents/<string:document_id>', methods=['DELETE'])
@authenticate_request()
def delete_document(document_id):
    """
    Endpoint 25.0: Securely deletes a document by its ID. 
    Requires ownership check before deleting the file from disk and the record from the database.
    """
    conn = None
    cur = None
    file_path_on_disk = None

    # 1. Input Validation and Accessing Auth User
    user_id = g.user_id 
    print(f"--- DEBUG 25.0 START ---\nUser ID: {user_id}\nDocument ID: {document_id}")

    try:
        # A. Get UPLOAD_FOLDER path
        upload_folder = app.config.get('UPLOAD_FOLDER')
        if not upload_folder:
            raise Exception("UPLOAD_FOLDER is not configured in app.config")
        
        file_path_on_disk = os.path.join(upload_folder, document_id)
        print(f"DEBUG 25.0: Resolved UPLOAD_FOLDER to: {upload_folder}")

        # B. Establish Database connection (Step 1 of fix)
        # We must explicitly call get_db_connection() first.
        conn = get_db_connection()
        if conn is None:
             return jsonify({"status": "error", "message": "Database connection failed"}), 500
        
        # C. Get the Cursor (Step 2 of fix)
        # Now conn is guaranteed to be a valid connection object.
        cur = get_db_cursor(conn, cursor_factory=psycopg2.extras.DictCursor)

        conn.autocommit = False 

        # 2. Security Check: Verify Document Ownership
        sql_check = """
            SELECT 1 
            FROM job_documents jd
            JOIN applications a ON jd.application_id = a.application_id
            WHERE jd.document_id = %s AND a.user_id = %s;
        """
        cur.execute(sql_check, (document_id, user_id))
        
        if cur.rowcount == 0:
            conn.rollback()
            print(f"DEBUG 25.0: Authorization failed for document ID: {document_id}")
            return jsonify({"status": "error", "message": "Document not found or unauthorized access."}), 404
        
        print(f"DEBUG 25.0: Document ownership verified. Proceeding to deletion.")

        # 3. Delete the Database Record
        sql_delete_db = "DELETE FROM job_documents WHERE document_id = %s;"
        cur.execute(sql_delete_db, (document_id,))
        
        # 4. Commit the DB change
        conn.commit()
        print(f"DEBUG 25.0: Database record deleted successfully.")

        # 5. Delete the file from the filesystem (Atomic check after DB commit)
        if os.path.exists(file_path_on_disk):
            os.remove(file_path_on_disk)
            print(f"DEBUG 25.0: File deleted from disk: {document_id}")
        else:
            print(f"WARNING 25.0: Database record deleted, but file was not found on disk at {file_path_on_disk}.")
            
        # 6. Success Response
        return jsonify({
            "status": "success", 
            "message": f"Document ID {document_id} and associated file deleted successfully."
        }), 200

    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"PostgreSQL Error in delete_document: {db_error_detail}")
        traceback.print_exc()
        return jsonify({"status": "error", "message": f"Database error during deletion: {db_error_detail}. Check server console for full traceback."}), 500
        
    except FileNotFoundError:
        print(f"File Not Found Error in delete_document for Document ID: {document_id}")
        # Assuming DB commit succeeded, we return success/warning
        return jsonify({"status": "warning", "message": "Database record deleted, but file was unexpectedly missing on disk."}), 200
        
    except Exception as e:
        # General Catch-All
        if conn: 
            try:
                conn.rollback()
            except Exception as rb_e:
                print(f"Rollback failed: {rb_e}")
                
        print(f"General Error in delete_document: {e}")
        traceback.print_exc() 
        return jsonify({"status": "error", "message": "Processing error during document deletion. Check server console for full traceback."}), 500

    finally:
        if conn:
            conn.autocommit = True
            if cur: cur.close()
            conn.close()
## MAIN (Included for optional local development testing)
if __name__ == '__main__':
    # This is for local development only. Gunicorn is typically used in production.
    app.run(debug=True, port=5000)

