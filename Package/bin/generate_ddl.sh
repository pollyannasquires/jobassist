#!/bin/bash

# Configuration
DB_NAME="contact_db"
OUTPUT_FILE="contact_db_ddl_$(date +%Y%m%d_%H%M%S).sql"

# You can uncomment and set the username if needed:
# DB_USER="your_postgres_user"
# USER_FLAG="-U ${DB_USER}" 

# --- Script Start ---

echo "--- Generating DDL for Database: $DB_NAME ---"

# The core command: pg_dump
# -s, --schema-only: Dumps only the object definitions (DDL), not the data.
# -O, --no-owner: Don't output commands to set ownership of objects.
# -x, --no-privileges: Don't output commands to grant privileges.
# -c, --clean: Include commands to DROP objects before creating them (makes the script re-runnable).
# -f, --file: Specifies the output file.

pg_dump \
    -s \
    -O \
    -x \
    -c \
    -d "$DB_NAME" \
    ${USER_FLAG} \
    -f "$OUTPUT_FILE"

# Check the exit status of pg_dump
if [ $? -eq 0 ]; then
    echo "--------------------------------------------------------"
    echo "✅ Success! DDL script created."
    echo "Output File: $OUTPUT_FILE"
    echo "--------------------------------------------------------"
else
    echo "--------------------------------------------------------"
    echo "❌ Error: DDL generation failed. Check your connection details and permissions."
    echo "--------------------------------------------------------"
fi

echo "--- Script finished. ---"