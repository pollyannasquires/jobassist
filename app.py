// ~/webapp/contact_app/frontend/app.js (LIST-BASED MAPPING)
const API_BASE = '/api';
let currentRawName = null;
=======
# app.py
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
# 1. GET NEXT UNPROCESSED COMPANY NAME
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
                company_name_mapping t2 ON t1.company = t2.raw_name
            WHERE 
                t2.raw_name IS NULL
                AND t1.company IS NOT NULL
            GROUP BY 
                t1.company
            LIMIT 1;
        """
        cur.execute(sql)
        
        result = cur.fetchone()
        if result:
            return jsonify({"raw_name": result['raw_name']})
        else:
            return jsonify({"raw_name": None, "message": "All companies have been mapped."})

    except Exception as e:
        return jsonify({"status": "error", "message": f"Database error: {e}"}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 2. GET SUGGESTED CLEAN COMPANY NAMES
# ----------------------------------------------------------------------
@app.route('/api/suggest_cleannames', methods=['GET'])
def suggest_cleannames():
    """Retrieves a list of all existing clean company names for suggestions."""
    conn = None
    try:
        conn = get_db_connection()
        # Use a DictCursor to get results as dictionaries
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # SQL to get all unique clean names from the companies table
        sql = """
            SELECT DISTINCT company_name_clean
            FROM companies
            WHERE company_name_clean IS NOT NULL
            ORDER BY company_name_clean;
        """
        cur.execute(sql)
        
        # Extract the clean names into a simple list
        results = [row['company_name_clean'] for row in cur.fetchall()]
        return jsonify({"clean_names": results})

    except Exception as e:
        return jsonify({"status": "error", "message": f"Database search error: {e}"}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 3. SUBMIT MAPPING (Raw Name to Clean Name)
# ----------------------------------------------------------------------
@app.route('/api/map_company', methods=['POST'])
def map_company():
    """Maps a raw company name to a clean company name."""
    data = request.get_json()
    raw_name = data.get('raw_name')
    clean_name = data.get('clean_name')
    conn = None

    if not raw_name or not clean_name:
        return jsonify({"status": "error", "message": "Missing raw_name or clean_name"}), 400

    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # Step 1: Find or Create the Company ID
        # Check if the clean company name already exists in the 'companies' table
        cur.execute("SELECT company_id FROM companies WHERE company_name_clean = %s", (clean_name,))
        company_id_result = cur.fetchone()
        
        company_id = None
        if company_id_result:
            company_id = company_id_result[0]
        else:
            # If it doesn't exist, insert the new clean name and get the new ID
            cur.execute(
                "INSERT INTO companies (company_name_clean) VALUES (%s) RETURNING company_id",
                (clean_name,)
            )
            company_id = cur.fetchone()[0]

        # Step 2: Insert the mapping into the 'company_name_mapping' table
        # This links the raw name to the new or existing company_id
        cur.execute(
            "INSERT INTO company_name_mapping (raw_name, company_id) VALUES (%s, %s)",
            (raw_name, company_id)
        )
        
        conn.commit()
        return jsonify({
            "status": "success",
            "message": f"Successfully mapped '{raw_name}' to '{clean_name}' (ID: {company_id})"
        })

    except psycopg2.IntegrityError as e:
        conn.rollback()
        # This handles cases where the raw_name is already mapped
        if 'unique_raw_name' in str(e):
             return jsonify({
                 "status": "error",
                 "message": f"The raw company name '{raw_name}' is already mapped."
             }), 409 # Conflict
        return jsonify({"status": "error", "message": f"SQL Error: {e.diag.message_primary}"}), 500
        
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": f"Processing error: {str(e)}"}), 500
    finally:
        if conn:
            conn.close()
            
# ----------------------------------------------------------------------
# 4. GET FULL LIST OF UNMAPPED COMPANY NAMES (For the Skip/List View)
# ----------------------------------------------------------------------
@app.route('/api/unmapped_list', methods=['GET'])
def get_unmapped_list():
    """Retrieves a list of all unique company names not yet mapped."""
    conn = None
    try:
        conn = get_db_connection()
        # Use a DictCursor to get results as dictionaries
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        # Check that table and column names are correct: contacts, company, company_name_mapping, raw_name
        sql = """
            SELECT 
                t1.company AS raw_name
            FROM 
                contacts t1
            LEFT JOIN 
                company_name_mapping t2 ON t1.company = t2.raw_name
            WHERE 
                t2.raw_name IS NULL
                AND t1.company IS NOT NULL
            GROUP BY 
                t1.company
            ORDER BY
                t1.company;
        """
        cur.execute(sql)
        
        results = [row['raw_name'] for row in cur.fetchall()]
        return jsonify({"raw_names": results})

    except Exception as e:
        return jsonify({"status": "error", "message": f"Database error: {e}"}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 5. GET/FILTER CLEAN COMPANY LIST (For company_list.html and management.html)
# ----------------------------------------------------------------------
@app.route('/api/companies', methods=['GET'])
def get_company_list():
    """
    Retrieves a list of all clean companies, optionally filtered by target interest 
    and search term.
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Get query parameters
        target_filter = request.args.get('target_interest')
        search_filter = request.args.get('search')
        
        # Build the WHERE clause dynamically
        where_clauses = ["company_name_clean IS NOT NULL"]
        params = []
        
        if target_filter in ['true', 'false']:
            where_clauses.append("target_interest = %s")
            params.append(target_filter.lower() == 'true')

        if search_filter:
            # Search across clean name, headquarters, or notes
            where_clauses.append("(company_name_clean ILIKE %s OR headquarters ILIKE %s OR notes ILIKE %s)")
            # Add wildcards for LIKE search
            search_pattern = f"%{search_filter}%"
            params.extend([search_pattern, search_pattern, search_pattern])

        where_sql = " AND ".join(where_clauses)
        
        sql = f"""
            SELECT 
                company_id, 
                company_name_clean, 
                target_interest, 
                headquarters,
                annual_revenue,
                revenue_scale
            FROM 
                companies
            WHERE 
                {where_sql}
            ORDER BY 
                company_name_clean;
        """

        cur.execute(sql, tuple(params))
        
        companies = []
        for row in cur.fetchall():
            company = dict(row)
            
            # Format revenue for display
            revenue_val = company['annual_revenue']
            revenue_scale = company['revenue_scale']
            if revenue_val is not None and revenue_scale:
                company['annual_revenue_formatted'] = f"{revenue_val} {revenue_scale}"
            else:
                company['annual_revenue_formatted'] = None
                
            companies.append(company)

        return jsonify({"companies": companies})

    except Exception as e:
        return jsonify({"status": "error", "message": f"Database search error: {e}"}), 500
    finally:
        if conn:
            conn.close()
            
# ----------------------------------------------------------------------
# 6. GET & PUT SINGLE COMPANY PROFILE (For management.html detail panel)
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>', methods=['GET', 'PUT'])
def manage_company(company_id):
    """Handles GET (fetch) and PUT (update) for a single company profile."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        if request.method == 'GET':
            # --- GET LOGIC ---
            sql = """
                SELECT 
                    company_id, 
                    company_name_clean, 
                    target_interest,
                    size_employees,
                    annual_revenue,
                    revenue_scale,
                    headquarters,
                    notes
                FROM companies
                WHERE company_id = %s;
            """
            cur.execute(sql, (company_id,))
            company = cur.fetchone()
            
            if company is None:
                return jsonify({"status": "error", "message": f"Company ID {company_id} not found."}), 404
            
            return jsonify({"status": "success", "company": dict(company)})

        elif request.method == 'PUT':
            # --- PUT LOGIC (Update company profile) ---
            data = request.get_json()
            
            sql = """
                UPDATE companies SET 
                    company_name_clean = %s,
                    target_interest = %s,
                    size_employees = %s,
                    annual_revenue = %s,
                    revenue_scale = %s,
                    headquarters = %s,
                    notes = %s
                WHERE company_id = %s;
            """
            cur.execute(sql, (\
                data.get('company_name_clean'),
                data.get('target_interest'),
                data.get('size_employees'),
                data.get('annual_revenue'),
                data.get('revenue_scale'),
                data.get('headquarters'),
                data.get('notes'),
                company_id
            ))
            
            conn.commit()
            return jsonify({"status": "success", "message": f"Company ID {company_id} updated."})

    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        # Use e.diag.message_primary for cleaner error messages
        return jsonify({"status": "error", "message": f"SQL Error: {e.diag.message_primary}"}), 500
    except Exception as e:
        if conn:
            conn.rollback()
        return jsonify({"status": "error", "message": f"Processing Error: {str(e)}"}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 7. GET RELATED DATA (Raw Names & Contacts) - TWO QUERY APPROACH
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>/related_data', methods=['GET'])
def get_related_data(company_id):
    """
    Retrieves all raw company names mapped to this clean company ID (Query 1), 
    and all contacts associated with those raw names (Query 2).
    """
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

        # Query 1: Get all raw names mapped to this company_id
        sql_raw_names = """
            SELECT raw_name 
            FROM company_name_mapping
            WHERE company_id = %s;
        """
        cur.execute(sql_raw_names, (company_id,))
        
        # Explicitly ensure raw_names are strings, filter non-values, and get unique list
        raw_names_list = [
            str(row['raw_name']).strip() 
            for row in cur.fetchall() 
            if row['raw_name'] is not None and str(row['raw_name']).strip()
        ]
        
        # Use a set to enforce uniqueness, then sort the list for a consistent output
        final_raw_names = sorted(list(set(raw_names_list)))
        
        # Query 2: Get all contacts associated with those raw names
        contacts = []
        if final_raw_names:
            # Create dynamic placeholders: e.g., "%s, %s, %s"
            placeholders = ', '.join(['%s'] * len(final_raw_names))
            
            # Use the PostgreSQL IN operator with dynamic placeholders
            sql_contacts = f"""
                SELECT 
                    first_name, 
                    last_name, 
                    position, -- Keeping position for context
                    url       -- ADDED: The URL column for LinkedIn link
                FROM contacts
                WHERE company IN ({placeholders}) 
                ORDER BY last_name, first_name;
            """
            
            # Pass the tuple of raw_names as the parameters
            # This is the point where the parameters are safely injected by psycopg2
            cur.execute(sql_contacts, tuple(final_raw_names))
            
            contacts = [dict(row) for row in cur.fetchall()]
        
        # Return the combined data
        return jsonify({
            "status": "success",
            "raw_names": final_raw_names,
            "contacts": contacts
        })

    except psycopg2.Error as e:
        # Specific database error handling
        print(f"PostgreSQL Error (2-Query method) in get_related_data for ID {company_id}: {e.diag.message_primary}")
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


## MAIN (Included for optional local development testing)
if __name__ == '__main__':
    # This is for local development only. Gunicorn is typically used in production.
    app.run(debug=True, port=5000)
