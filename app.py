# FILENAME: app.py | LAST EDITED: 2025-10-27 (DictCursor fix)
# FILENAME: app.py | LAST EDITED: 2025-10-27 (DictCursor fix)
from flask import Flask, g, jsonify, request, send_file, send_from_directory # Added send_from_directory
import psycopg2
import psycopg2.extras # Needed for dictionary cursor
import os
import uuid
from datetime import datetime
from werkzeug.utils import secure_filename
import io # Used in download_document logic (not strictly needed if using send_file)
import mimetypes # <--- endpoint 9: Required for guess_extension (fixes NameError)
from functools import wraps
import logging

app = Flask(__name__)

# --- Database Connection Configuration ---
DB_CONFIG = {
    'dbname': 'contact_db',
    'user': 'jobert',
    'password': 'linkedin',  # CHANGE THIS TO JOBERT'S PASSWORD
    'host': 'localhost'
}
# --- File Upload Configuration (NEW) ---
UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', '/home/jobert/webapp/contact_app/filestore') 
ALLOWED_MIME_TYPES = {
    'application/pdf', 
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document', # Official DOCX
    'application/zip',                                                         # Common fallback for DOCX (it's a zipped XML format)
    'application/octet-stream'                                                 # Generic binary type (often used when OS can't determine it)
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
    """Establishes and returns a new database connection."""
    # NOTE: The connection is returned and must be closed by the caller (e.g., in a finally block)
    return psycopg2.connect(**DB_CONFIG)

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
# --- END OF CORRECTED AUTHENTICATION BLOCK ---# --- API Endpoints ---

@app.route('/')
def index():
    # Simple endpoint for health check
    return "JobAssist Backend is running."

# ----------------------------------------------------------------------
# 1. GET ALL COMPANIES (Dashboard List View) - Handles /api/companies (NO ID)
# ----------------------------------------------------------------------
@app.route('/api/companies', methods=['GET']) # <<-- CHECK 1: This is correct for ALL companies
def get_companies():
    """Retrieves all standardized company profiles for the dashboard view."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Select key fields needed for the dashboard list
        sql = """
            SELECT company_id, company_name_clean, headquarters, size_employees, 
                   target_interest, annual_revenue
            FROM companies 
            ORDER BY company_name_clean;
        """
        cur.execute(sql)
        companies_data = [dict(row) for row in cur.fetchall()]
        
        return jsonify({
            "status": "success",
            "companies": companies_data
        }), 200

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in get_companies: {getattr(e.diag, 'message_primary', 'N/A')}")
        return jsonify({"status": "error", "message": "Database error retrieving company list."}), 500
    except Exception as e:
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
            SELECT company_id, company_name_clean, target_interest, size_employees, annual_revenue, revenue_scale, headquarters 
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
# ----------------------------------------------------------------------
@app.route('/api/company/<uuid:company_id>', methods=['PUT'])
def update_company_profile(company_id):
    # This function is assumed to be fully implemented and correct based on previous context.
    # It allows updating fields like target_interest, size_employees, etc.
    data = request.get_json()
    if not data:
        return jsonify({"status": "error", "message": "Invalid JSON input."}), 400

    # In a real app, we'd check user ownership here. Using MOCK_USER_ID for now.
    
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        updates = []
        values = []
        
        # Build the dynamic SQL query
        if 'target_interest' in data:
            updates.append("target_interest = %s")
            values.append(data['target_interest'])
        if 'size_employees' in data:
            updates.append("size_employees = %s")
            values.append(data['size_employees'])
        if 'annual_revenue' in data:
            updates.append("annual_revenue = %s")
            values.append(data['annual_revenue'])
        if 'revenue_scale' in data:
            updates.append("revenue_scale = %s")
            values.append(data['revenue_scale'])
        if 'headquarters' in data:
            updates.append("headquarters = %s")
            values.append(data['headquarters'])
            
        if not updates:
            return jsonify({"status": "warning", "message": "No fields provided for update."}), 200

        # Append company_id to values list for the WHERE clause
        values.append(company_id)
        
        update_query = f"UPDATE companies SET {', '.join(updates)} WHERE company_id = %s RETURNING *;"
        
        cur.execute(update_query, tuple(values))
        updated_company = cur.fetchone()
        
        if updated_company is None:
            conn.rollback()
            return jsonify({"status": "error", "message": "Company not found or unauthorized to update."}), 404

        conn.commit()
        return jsonify({
            "status": "success",
            "message": "Company profile updated successfully.",
            "updated_data": dict(updated_company)
        }), 200

    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        print(f"PostgreSQL Error in update_company_profile: {e}")
        return jsonify({"status": "error", "message": "Database error during company update."}), 500
        
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"General Error in update_company_profile: {e}")
        return jsonify({"status": "error", "message": "Processing error during company update."}), 500

    finally:
        if conn:
            conn.close()


# ----------------------------------------------------------------------
# 6. MAP RAW NAME TO EXISTING COMPANY (Standardization Action)
# ----------------------------------------------------------------------
@app.route('/api/map/existing', methods=['POST'])
def map_to_existing():
    """Maps a raw_name_id to an existing company_id."""
    data = request.get_json()
    raw_name_id = data.get('raw_name_id')
    company_id = data.get('company_id')

    if raw_name_id is None or company_id is None:
        return jsonify({"status": "error", "message": "raw_name_id and company_id are required."}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        sql = """
            UPDATE company_name_mapping
            SET company_id = %s
            WHERE raw_name_id = %s AND company_id IS NULL;
        """
        cur.execute(sql, (company_id, raw_name_id))

        if cur.rowcount == 0:
             return jsonify({
                "status": "error", 
                "message": "Mapping not updated. Raw Name ID not found or already mapped."
            }), 404
        
        conn.commit()

        return jsonify({
            "status": "success",
            "message": f"Raw name ID {raw_name_id} successfully mapped to existing company ID {company_id}."
        }), 200

    except psycopg2.Error as e:
        if conn: conn.rollback()
        print(f"PostgreSQL Error in map_to_existing: {getattr(e.diag, 'message_primary', 'N/A')}")
        return jsonify({"status": "error", "message": "Database error during existing map."}), 500
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error in map_to_existing: {e}")
        return jsonify({"status": "error", "message": "Processing error during existing map."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 7. MAP RAW NAME TO NEW COMPANY (Standardization Action)
# ----------------------------------------------------------------------
@app.route('/api/map/new', methods=['POST'])
def map_to_new():
    """Creates a new company record and maps the raw_name_id to it."""
    data = request.get_json()
    raw_name_id = data.get('raw_name_id')
    company_name_clean = data.get('company_name_clean')

    if raw_name_id is None or not company_name_clean:
        return jsonify({"status": "error", "message": "raw_name_id and company_name_clean are required."}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Start transaction: 1. Insert new company, 2. Get new ID, 3. Update mapping
        
        # 1. Insert new company
        sql_insert_company = """
            INSERT INTO companies (company_name_clean)
            VALUES (%s)
            RETURNING company_id;
        """
        cur.execute(sql_insert_company, (company_name_clean,))
        new_company_id = cur.fetchone()[0]
        
        # 2. Update mapping
        sql_update_mapping = """
            UPDATE company_name_mapping
            SET company_id = %s
            WHERE raw_name_id = %s AND company_id IS NULL;
        """
        cur.execute(sql_update_mapping, (new_company_id, raw_name_id))
        
        if cur.rowcount == 0:
            # This indicates the raw name was already mapped between the GET and this POST, or doesn't exist.
            conn.rollback() 
            return jsonify({
                "status": "error", 
                "message": "Mapping not updated. Raw Name ID not found or already mapped. New company was not created."
            }), 404

        conn.commit()

        return jsonify({
            "status": "success",
            "message": f"New company ID {new_company_id} created and raw name ID {raw_name_id} mapped successfully."
        }), 201

    except psycopg2.Error as e:
        if conn: conn.rollback()
        print(f"PostgreSQL Error in map_to_new: {getattr(e.diag, 'message_primary', 'N/A')}")
        return jsonify({"status": "error", "message": "Database error during new map."}), 500
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error in map_to_new: {e}")
        return jsonify({"status": "error", "message": "Processing error during new map."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 8. MAP RAW NAME TO SELF (Standardization Action - No Standardization needed)
# ----------------------------------------------------------------------
@app.route('/api/map/self', methods=['POST'])
def map_to_self():
    """Creates a new company record using the raw name as the clean name and maps the raw_name_id to it."""
    data = request.get_json()
    raw_name_id = data.get('raw_name_id')
    raw_name = data.get('raw_name') # Expected to be the same as the name used for the company

    if raw_name_id is None or not raw_name:
        return jsonify({"status": "error", "message": "raw_name_id and raw_name are required."}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Insert new company using the raw name as the clean name
        sql_insert_company = """
            INSERT INTO companies (company_name_clean)
            VALUES (%s)
            RETURNING company_id;
        """
        cur.execute(sql_insert_company, (raw_name,))
        new_company_id = cur.fetchone()[0]
        
        # 2. Update mapping
        sql_update_mapping = """
            UPDATE company_name_mapping
            SET company_id = %s
            WHERE raw_name_id = %s AND company_id IS NULL;
        """
        cur.execute(sql_update_mapping, (new_company_id, raw_name_id))

        if cur.rowcount == 0:
            conn.rollback()
            return jsonify({
                "status": "error", 
                "message": "Mapping not updated. Raw Name ID not found or already mapped. New company was not created."
            }), 404

        conn.commit()

        return jsonify({
            "status": "success",
            "message": f"New company ID {new_company_id} created (using raw name) and raw name ID {raw_name_id} mapped successfully."
        }), 201

    except psycopg2.Error as e:
        if conn: conn.rollback()
        print(f"PostgreSQL Error in map_to_self: {getattr(e.diag, 'message_primary', 'N/A')}")
        return jsonify({"status": "error", "message": "Database error during self map."}), 500
    except Exception as e:
        if conn: conn.rollback()
        print(f"General Error in map_to_self: {e}")
        return jsonify({"status": "error", "message": "Processing error during self map."}), 500
    finally:
        if conn:
            conn.close()
def get_db_cursor(cursor_factory=psycopg2.extras.DictCursor):
    """Returns a connection and a DictCursor (default)."""
    conn = psycopg2.connect(**DB_CONFIG)
    cur = conn.cursor(cursor_factory=cursor_factory)
    return conn, cur

# ----------------------------------------------------------------------
# 9. DOCUMENT UPLOAD API: POST /api/application/<uuid:application_id>/documents
# Route now uses the 'uuid' converter defined above.
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

    # --- NEW REQUIRED FIELD: document_type ---
    document_type_code = request.form.get('document_type_code')
    
    if not document_type_code:
         return jsonify({"status": "error", "message": "Missing required field: document_type_code"}), 400

    # 2. Map front-end code (e.g., 'resume') to the database's strict ALL_CAPS ENUM (e.g., 'RESUME')
    # This dictionary ensures we send the exact, verified case to PostgreSQL.
    ENUM_MAP = {
        'JOB_DESCRIPTION': 'JOB_DESCRIPTION',
        'RESUME': 'RESUME',
        'COVER_LETTER': 'COVER_LETTER',
        'ASSESSMENT_FORM': 'ASSESSMENT_FORM',
        'OTHER': 'OTHER',
        # You could also add lowercase keys here for robustness if your frontend uses them
        'resume': 'RESUME',
        'cover_letter': 'COVER_LETTER'
    }

    document_type = ENUM_MAP.get(document_type_code.upper())

    if not document_type:
        return jsonify({"status": "error", "message": f"Invalid document type code provided: {document_type_code}"}), 400
    
    print(f"DEBUG 9.0: Mapped document type code: {document_type_code} -> ENUM value: {document_type}")
    # --- END NEW FIELD LOGIC ---

    if 'document' not in request.files:
        return jsonify({"status": "error", "message": "No document part in the request"}), 400
    
    document = request.files['document']
    if document.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400

    # 3. MIME Type Validation
    mime_type = document.mimetype
    print(f"DEBUG 9.0: Original filename: {document.filename}, MIME Type: {mime_type}")
    
    if mime_type not in app.config['ALLOWED_MIME_TYPES']:
        return jsonify({"status": "error", "message": f"Unsupported file type: {mime_type}"}), 415 

    try:
        conn, cur = get_db_cursor()
        print("DEBUG 9.0: Database connection established.")

        # 4. Security Check: Verify Application Ownership 
        cur.execute(
            "SELECT application_id FROM applications WHERE application_id = %s AND user_id = %s",
            (application_id_str, user_id) 
        )
        if cur.fetchone() is None:
            return jsonify({"status": "error", "message": "Application not found or unauthorized."}), 404
        
        print("DEBUG 9.0: Application ownership verified.")
        
        # 5. Save File to Disk
        original_filename = secure_filename(document.filename)
        file_uuid = str(uuid.uuid4())
        save_path = os.path.join(app.config['UPLOAD_FOLDER'], file_uuid)
        
        os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
        document.save(save_path)
        print("DEBUG 9.0: File saved successfully to disk.")

        # 6. Database Insertion using the confirmed ENUM value
        cur.execute(
            """
            INSERT INTO job_documents 
                (document_id, application_id, document_type, original_filename, file_path, mime_type, upload_timestamp)
            VALUES 
                (%s, %s, %s, %s, %s, %s, NOW()) 
            RETURNING document_id
            """,
            (file_uuid, application_id_str, document_type, original_filename, file_uuid, mime_type) 
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
        print(f"PostgreSQL Error in upload_document: {e}")
        return jsonify({"status": "error", "message": "Database error during document save (Check column names and types).", "detail": str(e)}), 500
        
    except Exception as e:
        # Catch file system errors or other exceptions
        print(f"General Error in upload_document: {e}")
        error_detail = str(e)
        # Attempt to clean up the file if it was saved before the exception
        if save_path and os.path.exists(save_path):
             os.remove(save_path)
        return jsonify({"status": "error", "message": "Processing error during file upload.", "detail": error_detail}), 500

    finally:
        if cur:
            cur.close()
        if conn:
            conn.close()
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
# 12. DOCUMENT DOWNLOAD API: GET /api/documents/<string:file_path>
# ----------------------------------------------------------------------


@app.route('/api/documents/<string:file_path>', methods=['GET'])
def download_document(file_path):
    """
    Endpoint 12: Downloads a document using its secure filename (which is now document_id).
    Requires ownership check before serving the file from disk.
    """
    conn = get_db_connection()
    if conn is None:
        return jsonify({"status": "error", "message": "Database connection failed"}), 500

    try:
        cur = conn.cursor()
        
        # 1. Check document existence and ownership (Security critical!)
        # FIX: Changed 'secure_filename' to 'document_id' for lookup.
        sql_check = """
            SELECT jd.original_filename
            FROM job_documents jd
            JOIN applications a ON jd.application_id = a.application_id
            WHERE jd.document_id = %s AND a.user_id = %s;
        """
        cur.execute(sql_check, (file_path, MOCK_USER_ID))
        result = cur.fetchone()

        if not result:
            # File not found OR not owned by the current user (security enforced)
            # Returning 404 instead of 403 prevents attackers from confirming file existence.
            return jsonify({"status": "error", "message": "File not found or unauthorized access."}), 404
        
        original_filename = result[0]

        # 2. Serve the file securely using Flask's send_from_directory
        # The file_path parameter contains the document_id (which is the file's UUID on disk).
        return send_from_directory(
            app.config['UPLOAD_FOLDER'], 
            file_path, 
            as_attachment=True, # Forces a download dialog
            download_name=original_filename # Uses the user's original file name
        )

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in download_document: {getattr(e.diag, 'message_primary', 'N/A')}")
        return jsonify({"status": "error", "message": "Database error during ownership check."}), 500
        
    except Exception as e:
        print(f"General Error in download_document: {e}")
        return jsonify({"status": "error", "message": "Processing error."}), 500

    finally:
        if conn:
            conn.close()
## MAIN (Included for optional local development testing)
if __name__ == '__main__':
    # This is for local development only. Gunicorn is typically used in production.
    app.run(debug=True, port=5000)

