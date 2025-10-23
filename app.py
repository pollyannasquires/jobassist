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
    'password': 'linkedin',  # <<< CHANGE THIS TO JOBERT'S PASSWORD
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
            return jsonify({"raw_name": None, "message": "All unique companies have been mapped!"})

    except Exception as e:
        return jsonify({"status": "error", "message": f"Database error: {e}"}), 500
    finally:
        if conn:
            conn.close()

# ----------------------------------------------------------------------
# 2. HANDLE MAPPING (CREATE NEW PROFILE OR LINK TO EXISTING)
# ----------------------------------------------------------------------
@app.route('/api/map_company', methods=['POST'])
def map_company():
    """
    Handles user input to map a raw name to a company ID.
    If company_id is None, it creates a new company profile first.
    """
    data = request.get_json()
    raw_name = data.get('raw_name')
    # If the user selected an existing ID, it's passed here. If they created a new one, this is None.
    company_id = data.get('company_id') 
    
    if not raw_name:
        return jsonify({"status": "error", "message": "Missing raw_name"}), 400

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()

        # --- A. Create NEW Company Profile (If company_id is not provided) ---
        if company_id is None:
            clean_name = data.get('company_name_clean', raw_name) # Use raw_name as fallback clean name
            
            # Insert new company and get the generated ID
            cur.execute("""
	INSERT INTO companies (company_name_clean, target_interest, size_employees, annual_revenue, revenue_scale, headquarters, notes)
    VALUES (%s, %s, %s, %s, %s, %s, %s)
    RETURNING company_id;
    """, (
	      	clean_name,
                    data.get('target_interest', False),
                    data.get('size_employees'),
		data.get('annual_revenue'),
            data.get('revenue_scale'), # <<< NEW FIELD
            data.get('headquarters'),
            data.get('notes')
        ))
            company_id = cur.fetchone()[0]
        
        # --- B. Map the Raw Name to the Company ID ---
        # This handles both newly created companies and existing ones
        cur.execute("""
            INSERT INTO company_name_mapping (raw_name, company_id)
            VALUES (%s, %s);
            """, (raw_name, company_id))
        
        conn.commit()
        return jsonify({"status": "success", "message": f"'{raw_name}' mapped to company_id {company_id}"})
    except psycopg2.Error as e:
       conn.rollback()
       return jsonify({"status": "error", "message": f"SQL Error: {e.diag.message_primary}"}), 500
    except Exception as e:
       conn.rollback()
       return jsonify({"status": "error", "message": f"Processing Error: {str(e)}"}), 500
    finally: # <--- THIS MUST BE PRESENT AND AT THE CORRECT INDENTATION LEVEL (4 spaces)
          if conn:
            conn.close()

# ----------------------------------------------------------------------
# 3. SEARCH EXISTING COMPANIES (For the user interface to check for duplicates)
# ----------------------------------------------------------------------
@app.route('/api/search_companies', methods=['GET'])
def search_companies():
    """Allows the UI to search for existing clean company profiles by name."""
    search_term = request.args.get('q', '').strip()
    if not search_term:
        return jsonify({"companies": []})

    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        # Case-insensitive search using ILIKE
        sql = """
            SELECT company_id, company_name_clean, headquarters
            FROM companies
            WHERE company_name_clean ILIKE %s
            ORDER BY company_name_clean
            LIMIT 10;
        """
        cur.execute(sql, (f'%{search_term}%',))
        
        companies = [dict(row) for row in cur.fetchall()]
        return jsonify({"companies": companies})

    except Exception as e:
        return jsonify({"status": "error", "message": f"Database search error: {e}"}), 500
    finally:
        if conn:
          conn.close()
# ----------------------------------------------------------------------
# 4. GET FULL LIST OF UNMAPPED COMPANY NAMES
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
# 5. COMPANY MANAGEMENT - GET LIST / GET SINGLE
# ----------------------------------------------------------------------
@app.route('/api/companies', methods=['GET'])
@app.route('/api/companies/<int:company_id>', methods=['GET'])
def get_companies(company_id=None):
    """Retrieves list of all clean companies or details for a single company."""
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
        
        if company_id:
            # Get single company details
            sql = """
                SELECT company_id, company_name_clean, target_interest, size_employees, annual_revenue, revenue_scale, headquarters, notes
                FROM companies
                WHERE company_id = %s;
            """
            cur.execute(sql, (company_id,))
            company = cur.fetchone()
            
            if company:
                company_data = dict(company)
                
                # Fetch all mapped raw names for this company
                map_sql = """
                    SELECT raw_name 
                    FROM company_name_mapping 
                    WHERE company_id = %s
                    ORDER BY raw_name;
                """
                cur.execute(map_sql, (company_id,))
                
                # Add the list of raw names to the company dictionary
                company_data['mapped_names'] = [row['raw_name'] for row in cur.fetchall()]
                
                return jsonify(company_data)
            else:
                return jsonify({"message": "Company not found"}), 404
        else:
            # Get list of all companies
            sql = """
                SELECT company_id, company_name_clean, headquarters
                FROM companies
                ORDER BY company_name_clean;
            """
            cur.execute(sql)
            companies = [dict(row) for row in cur.fetchall()]
            return jsonify({"companies": companies})

    except Exception as e:
        return jsonify({"status": "error", "message": f"Database error: {e}"}), 500
    finally:
        if conn:
            conn.close()
# ----------------------------------------------------------------------
# 6. COMPANY MANAGEMENT - UPDATE SINGLE COMPANY
# ----------------------------------------------------------------------
@app.route('/api/companies/<int:company_id>', methods=['PUT'])
def update_company(company_id):
    """Updates an existing company profile."""
    data = request.get_json()
    conn = None
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
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
        cur.execute(sql, (
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
        conn.rollback()
        return jsonify({"status": "error", "message": f"SQL Error: {e.diag.message_primary}"}), 500
    except Exception as e:
        conn.rollback()
        return jsonify({"status": "error", "message": f"Processing Error: {str(e)}"}), 500
    finally:
        if conn:
            conn.close()
## MAIN
if __name__ == '__main__':
    # This is for local development only. Gunicorn is used in production.
    app.run(debug=True, port=5000)

