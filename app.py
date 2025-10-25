# FILENAME: app.py | LAST EDITED: 2025-10-24
from flask import Flask, jsonify, request
import psycopg2
import psycopg2.extras # Needed for dictionary cursor
import os

app = Flask(__name__)

# --- Database Connection Configuration ---
DB_CONFIG = {
    'dbname': 'contact_db',
    'user': 'jobert',
    'password': 'linkedin',  # CHANGE THIS TO JOBERT'S PASSWORD
    'host': 'localhost'
}

def get_db_connection():
    """Establishes and returns a new database connection."""
    return psycopg2.connect(**DB_CONFIG)

# --- API Endpoints ---

@app.route('/')
def index():
    """Placeholder for the static frontend to load."""
    return 'Contact Mapping Application Backend is Running. Frontend UI goes here.'

# ----------------------------------------------------------------------
# 1. GET NEXT UNPROCESSED COMPANY NAME (Cleanup Tool)
# ----------------------------------------------------------------------
@app.route('/api/next_company', methods=['GET'])
def get_next_company():
    """Retrieves the next unique company name that has not yet been mapped."""
    conn = None
    try:
        conn = get_db_connection()
        # Use a DictCursor to get results as dictionaries (easier to work with)
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # SQL to find one company name from 'contacts' that is NOT in 'company_name_mapping'
        sql = """
            SELECT 
                t1.company AS raw_name
            FROM 
                contacts t1
            LEFT JOIN 
                company_name_mapping t2 
            ON 
                t1.company = t2.raw_name
            WHERE 
                t2.raw_name IS NULL
            GROUP BY 
                t1.company
            LIMIT 1;
        """
        cur.execute(sql)
        
        company = cur.fetchone()
        
        if company:
            return jsonify({
                "status": "success",
                "raw_name": company['raw_name']
            })
        else:
            return jsonify({
                "status": "success",
                "raw_name": None,
                "message": "All raw company names have been mapped."
            })

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in get_next_company: {e.diag.message_primary}")
        return jsonify({"status": "error", "message": "Database error retrieving next company."}), 500
    except Exception as e:
        print(f"General Error in get_next_company: {e}")
        return jsonify({"status": "error", "message": "Processing error retrieving next company."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 2. GET ALL STANDARDIZED COMPANIES (Dashboard View)
# ----------------------------------------------------------------------
@app.route('/api/companies', methods=['GET'])
def get_all_companies():
    """Retrieves all standardized company profiles for the dashboard view."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # SQL to retrieve all standardized companies
        sql = """
            SELECT 
                company_id,
                company_name_clean,
                headquarters,
                size_employees,
                annual_revenue,
                revenue_scale,
                target_interest
            FROM 
                companies
            ORDER BY 
                company_name_clean;
        """
        cur.execute(sql)
        companies_data = cur.fetchall()
        
        # Convert DictRow objects to plain dictionaries for jsonify
        companies_list = [dict(row) for row in companies_data]

        return jsonify({
            "status": "success",
            "companies": companies_list
        })

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in get_all_companies: {e.diag.message_primary}")
        return jsonify({"status": "error", "message": "Database error retrieving company list."}), 500
    except Exception as e:
        print(f"General Error in get_all_companies: {e}")
        return jsonify({"status": "error", "message": "Processing error retrieving company list."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 3. GET SINGLE COMPANY PROFILE (Management View)
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>', methods=['GET'])
def get_company_profile(company_id):
    """Retrieves a single standardized company profile by ID."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        sql = """
            SELECT 
                company_id,
                company_name_clean,
                headquarters,
                size_employees,
                annual_revenue,
                revenue_scale,
                target_interest,
                notes
            FROM 
                companies
            WHERE 
                company_id = %s;
        """
        cur.execute(sql, (company_id,))
        company = cur.fetchone()
        
        if company:
            return jsonify({
                "status": "success",
                "company": dict(company)
            })
        else:
            return jsonify({"status": "error", "message": f"Company with ID {company_id} not found."}), 404

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in get_company_profile for ID {company_id}: {e.diag.message_primary}")
        return jsonify({"status": "error", "message": f"Database error loading profile for ID {company_id}."}), 500
    except Exception as e:
        print(f"General Error in get_company_profile for ID {company_id}: {e}")
        return jsonify({"status": "error", "message": f"Processing error loading profile for ID {company_id}."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 4. UPDATE COMPANY PROFILE (Management Save)
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>', methods=['PUT'])
def update_company_profile(company_id):
    """Updates the enrichment data for a standardized company profile."""
    data = request.get_json()
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Extract data from the request body
        clean_name = data.get('company_name_clean')
        headquarters = data.get('headquarters')
        size_employees = data.get('size_employees')
        annual_revenue = data.get('annual_revenue')
        revenue_scale = data.get('revenue_scale')
        # Ensure target_interest is properly cast to a boolean
        target_interest = bool(data.get('target_interest', False))
        notes = data.get('notes')

        # Basic validation
        if not clean_name:
            return jsonify({"status": "error", "message": "Clean company name is required."}), 400

        sql = """
            UPDATE companies
            SET 
                company_name_clean = %s,
                headquarters = %s,
                size_employees = %s,
                annual_revenue = %s,
                revenue_scale = %s,
                target_interest = %s,
                notes = %s
            WHERE 
                company_id = %s;
        """
        params = (
            clean_name,
            headquarters,
            size_employees if size_employees is not None else None, 
            annual_revenue if annual_revenue is not None else None, 
            revenue_scale,
            target_interest,
            notes,
            company_id
        )

        cur.execute(sql, params)
        conn.commit()
        
        if cur.rowcount == 0:
            return jsonify({"status": "error", "message": f"Company with ID {company_id} not found for update."}), 404

        # Return the updated data structure
        return jsonify({
            "status": "success",
            "message": "Company profile updated successfully.",
            "updated_data": {
                "company_id": company_id,
                "company_name_clean": clean_name,
                "target_interest": target_interest,
            }
        })

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in update_company_profile for ID {company_id}: {e.diag.message_primary}")
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "message": f"Database error during update for ID {company_id}."}), 500
    except Exception as e:
        print(f"General Error in update_company_profile for ID {company_id}: {e}")
        return jsonify({"status": "error", "message": f"Processing error during update for ID {company_id}."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 5. GET RELATED RAW NAMES AND CONTACTS 
#    (Supports Management View - Populates Raw Names & Contacts sections)
# ----------------------------------------------------------------------
@app.route('/api/related_data/<int:company_id>', methods=['GET'])
def get_related_data(company_id):
    """
    Retrieves the list of raw company names mapped to a company ID,
    and all associated contact records.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # 1. Get all raw names mapped to this standardized company ID
        sql_raw_names = """
            SELECT 
                raw_name
            FROM 
                company_name_mapping
            WHERE 
                company_id = %s;
        """
        cur.execute(sql_raw_names, (company_id,))
        raw_names_data = cur.fetchall()
        final_raw_names = [row['raw_name'] for row in raw_names_data]

        if not final_raw_names:
             return jsonify({
                "status": "error",
                "message": f"No raw names found mapped to company ID {company_id}. Check data integrity."
            }), 404
        
        # 2. Get all contacts associated with those raw names
        # We need placeholders for the IN clause based on the number of raw names
        placeholders = ','.join(['%s'] * len(final_raw_names))
        sql_contacts = f"""
            SELECT 
                first_name, 
                last_name, 
                position, 
                email_address, 
                url 
            FROM 
                contacts
            WHERE 
                company IN ({placeholders})
            ORDER BY last_name, first_name;
        """
        cur.execute(sql_contacts, final_raw_names)
        contacts_data = cur.fetchall()
        
        # Format contacts for the frontend
        contacts = []
        for row in contacts_data:
            contacts.append({
                "name": f"{row['first_name']} {row['last_name']}",
                "job_title": row['position'],         # Map position to job_title
                "email": row['email_address'],        # Map email_address to email
                "linkedin_url": row['url']            # Map url to linkedin_url
            })
        
        # Return the combined data
        return jsonify({
            "status": "success",
            "raw_names": final_raw_names,
            "contacts": contacts
        })

    except psycopg2.Error as e:
        # Specific database error handling
        print(f"PostgreSQL Error in get_related_data for ID {company_id}: {e.diag.message_primary}")
        if conn:
            conn.rollback()
        # Return a generic error message to the client, but log the specific one
        return jsonify({"status": "error", "message": f"Database SQL Error: Could not load related data for ID {company_id}."}), 500

    except Exception as e:
        # General processing error
        print(f"General Error in get_related_data for company ID {company_id}: {e}")
        # Return a generic error message to the client
        return jsonify({"status": "error", "message": f"Processing Error: Could not load related data for ID {company_id}."}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 6. RAW NAME MAPPING ENDPOINTS (Cleanup Tool)
# ----------------------------------------------------------------------

def execute_mapping_transaction(raw_name, clean_name, target_interest):
    """
    Helper function to handle the complex database logic for mapping.
    This logic should be fully transactional.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Check if raw_name is already mapped
        sql_check = "SELECT company_id FROM company_name_mapping WHERE raw_name = %s;"
        cur.execute(sql_check, (raw_name,))
        if cur.fetchone():
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
        else:
            # Company does not exist, create a new profile
            sql_create_company = """
                INSERT INTO companies 
                    (company_name_clean, target_interest, notes)
                VALUES 
                    (%s, %s, %s) 
                RETURNING company_id;
            """
            cur.execute(sql_create_company, (clean_name, target_interest, f"Auto-created from raw name: {raw_name}"))
            company_id = cur.fetchone()[0]
            action = "created"

        # 3. Create the mapping record
        sql_map = """
            INSERT INTO company_name_mapping 
                (raw_name, company_id)
            VALUES 
                (%s, %s);
        """
        cur.execute(sql_map, (raw_name, company_id))

        conn.commit()
        return {
            "status": "success", 
            "message": f"'{raw_name}' mapped to '{clean_name}'. Company profile was {action}.",
            "company_id": company_id,
            "company_name_clean": clean_name,
            "target_interest": target_interest
        }, 200

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in execute_mapping_transaction for raw name '{raw_name}': {e.diag.message_primary}")
        if conn:
            conn.rollback()
        return {"status": "error", "message": "Database error during mapping transaction."}, 500
    except Exception as e:
        print(f"General Error in execute_mapping_transaction for raw name '{raw_name}': {e}")
        return {"status": "error", "message": "Processing error during mapping transaction."}, 500
    finally:
        if conn:
            conn.close()


@app.route('/api/map/existing', methods=['POST'])
def map_to_existing_company():
    """Cleanup Action 1: Map an unmapped raw name to an existing standardized company ID."""
    data = request.get_json()
    raw_name = data.get('raw_name')
    company_id = data.get('company_id')

    if not all([raw_name, company_id]):
        return jsonify({"status": "error", "message": "raw_name and company_id are required."}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # 1. Check if raw_name is already mapped (Prevent duplicate processing)
        sql_check_raw = "SELECT company_id FROM company_name_mapping WHERE raw_name = %s;"
        cur.execute(sql_check_raw, (raw_name,))
        if cur.fetchone():
            return jsonify({"status": "error", "message": f"Raw name '{raw_name}' is already mapped."}), 409
        
        # 2. Check if the target company_id exists
        sql_check_company = "SELECT company_name_clean FROM companies WHERE company_id = %s;"
        cur.execute(sql_check_company, (company_id,))
        company_row = cur.fetchone()
        if not company_row:
            return jsonify({"status": "error", "message": f"Target company ID {company_id} does not exist."}), 404
        
        clean_name = company_row[0]

        # 3. Create the mapping record
        sql_map = """
            INSERT INTO company_name_mapping 
                (raw_name, company_id)
            VALUES 
                (%s, %s);
        """
        cur.execute(sql_map, (raw_name, company_id))
        conn.commit()

        return jsonify({
            "status": "success",
            "message": f"'{raw_name}' successfully mapped to existing company '{clean_name}' (ID: {company_id}).",
            "company_id": company_id,
            "company_name_clean": clean_name
        })

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in map_to_existing_company: {e.diag.message_primary}")
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "message": "Database error during mapping."}), 500
    except Exception as e:
        print(f"General Error in map_to_existing_company: {e}")
        return jsonify({"status": "error", "message": "Processing error during mapping."}), 500
    finally:
        if conn:
            conn.close()


@app.route('/api/map/new', methods=['POST'])
def map_to_new_company():
    """Cleanup Action 2: Create a new standardized profile and map the raw name to it."""
    data = request.get_json()
    raw_name = data.get('raw_name')
    new_clean_name = data.get('new_clean_name')
    # Default to False if not provided or provided as None
    target_interest = bool(data.get('target_interest', False)) 

    if not all([raw_name, new_clean_name]):
        return jsonify({"status": "error", "message": "raw_name and new_clean_name are required."}), 400

    response_data, status_code = execute_mapping_transaction(raw_name, new_clean_name, target_interest)
    return jsonify(response_data), status_code

@app.route('/api/map/self', methods=['POST'])
def map_to_self():
    """Cleanup Action 3: Use the raw name as the clean name and map to it (flagged as TARGET by default)."""
    data = request.get_json()
    raw_name = data.get('raw_name')
    
    if not raw_name:
        return jsonify({"status": "error", "message": "raw_name is required."}), 400

    # Self-map logic: clean_name is the raw_name, and target_interest is TRUE by default
    response_data, status_code = execute_mapping_transaction(raw_name, raw_name, True)
    
    # Customize success message for the self-map endpoint
    if response_data.get("status") == "success":
         response_data["message"] = f"'{raw_name}' self-mapped and flagged as a TARGET."

    return jsonify(response_data), status_code

@app.route('/api/map/batch', methods=['POST'])
def map_batch():
    """Cleanup Action 4: Batch process all remaining unmapped names (Self-map, TARGET=TRUE)."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # 1. Find all unmapped raw names
        sql_unmapped = """
            SELECT 
                t1.company AS raw_name
            FROM 
                contacts t1
            LEFT JOIN 
                company_name_mapping t2 
            ON 
                t1.company = t2.raw_name
            WHERE 
                t2.raw_name IS NULL
            GROUP BY 
                t1.company;
        """
        cur.execute(sql_unmapped)
        unmapped_names = [row['raw_name'] for row in cur.fetchall()]
        
        processed_count = 0
        
        # Process each unmapped name using the transactional helper
        for raw_name in unmapped_names:
            response_data, status_code = execute_mapping_transaction(raw_name, raw_name, True)
            
            # Only count if the transaction was successful (status_code 200)
            if status_code == 200:
                processed_count += 1
        
        return jsonify({
            "status": "success",
            "message": "Batch mapping complete.",
            "processed_count": processed_count
        })

    except psycopg2.Error as e:
        print(f"PostgreSQL Error in map_batch: {e.diag.message_primary}")
        return jsonify({"status": "error", "message": "Database error during batch mapping."}), 500
    except Exception as e:
        print(f"General Error in map_batch: {e}")
        return jsonify({"status": "error", "message": "Processing error during batch mapping."}), 500
    finally:
        if conn:
            conn.close()


## MAIN (Included for optional local development testing)
if __name__ == '__main__':
    # This is for local development only. Gunicorn is typically used in production.
    app.run(debug=True, port=5000)
