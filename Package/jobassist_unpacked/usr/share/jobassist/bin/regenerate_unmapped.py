import psycopg2
from typing import Optional

# --- CONFIGURATION PLACEHOLDER ---
# NOTE: Replace this with your actual database connection function or details.
# This function must return a connection object.
def get_db_connection() -> Optional[psycopg2.extensions.connection]:
    """
    Establishes and returns a PostgreSQL database connection.
    This is a placeholder and MUST be configured with your actual credentials.
    """
    try:
        # Replace these connection parameters with your actual settings
        conn = psycopg2.connect(
            dbname="contact_db",
            user="jobert",
            password="linkedin",
            host="localhost",
            port="5432"
        )
        return conn
    except psycopg2.Error as e:
        print(f"Error connecting to the database: {e}")
        return None
# ---------------------------------

def regenerate_missing_mappings():
    """
    Identifies all unique company names in the 'contacts' table that are missing 
    from 'company_name_mapping' and inserts them as unmapped records (company_id=NULL).
    """
    conn = None
    try:
        conn = get_db_connection()
        if conn is None:
            print("❌ Failed to establish a database connection. Exiting.")
            return

        cur = conn.cursor()

        # The core SQL statement to insert missing mappings
        sql = """
            INSERT INTO company_name_mapping (raw_name, company_id)
            SELECT DISTINCT
                c.company AS raw_name,
                -- FIX: Explicitly cast NULL to INTEGER to prevent 'text' type mismatch
                NULL::INTEGER AS company_id
            FROM 
                contacts c
            LEFT JOIN 
                company_name_mapping cnm ON c.company = cnm.raw_name
            WHERE 
                -- Condition 1: Isolates raw names that had no match in the mapping table
                cnm.raw_name IS NULL         
                -- Condition 2: Ensures we only process non-null company names from the contacts table
                AND c.company IS NOT NULL
            ON CONFLICT (raw_name) DO NOTHING; -- Ensure idempotency if concurrent operations occur
        """
        
        print("🔍 Searching for and regenerating missing raw name mappings...")
        cur.execute(sql)
        rows_inserted = cur.rowcount
        
        conn.commit()
        
        if rows_inserted > 0:
            print(f"✅ Success: Successfully regenerated {rows_inserted} missing raw name mappings.")
        else:
            print("☑️  No missing raw name mappings found. Database is consistent.")

    except psycopg2.Error as e:
        if conn:
            conn.rollback()
        db_error_detail = getattr(e.diag, 'message_primary', 'N/A')
        print(f"❌ PostgreSQL Error during regeneration: {db_error_detail}")
    except Exception as e:
        if conn:
            conn.rollback()
        print(f"❌ General Error during regeneration: {e}")
    finally:
        if conn:
            cur.close()
            conn.close()
            print("Database connection closed.")

if __name__ == "__main__":
    regenerate_missing_mappings()
