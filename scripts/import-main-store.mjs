import fs from 'node:fs/promises';
import path from 'node:path';

const DEFAULT_SUPABASE_URL = 'https://poepfebjdnhlszflhqzs.supabase.co';
const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvZXBmZWJqZG5obHN6ZmxocXpzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ1NzU5MDcsImV4cCI6MjA5MDE1MTkwN30.HT9-4TptQZwXewyQfwGHb0EGcZMDDIUSdt1eKlSwSoY';

function parseArgs(argv) {
    const args = { csv: '', restaurantId: '' };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        const next = argv[index + 1];

        if (arg === '--csv' && next) {
            args.csv = next;
            index += 1;
        } else if (arg === '--restaurant-id' && next) {
            args.restaurantId = next;
            index += 1;
        }
    }

    return args;
}

function parseCsvLine(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];

        if (char === '"' && inQuotes && next === '"') {
            current += '"';
            index += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }

    values.push(current.trim());
    return values;
}

function parseCsv(text) {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

    if (lines.length < 2) {
        throw new Error('CSV must include a header row and at least one data row.');
    }

    const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
    return lines.slice(1).map((line, rowIndex) => {
        const values = parseCsvLine(line);
        const row = {};

        headers.forEach((header, headerIndex) => {
            row[header] = values[headerIndex] ?? '';
        });

        row.__rowNumber = rowIndex + 2;
        return row;
    });
}

function normalizeRow(row, fallbackRestaurantId) {
    const restaurantId = row.restaurant_id || fallbackRestaurantId;
    const conversionFactor = Number(row.conversion_factor);
    const price = Number(row.price);

    if (!row.name) {
        throw new Error(`Row ${row.__rowNumber}: name is required.`);
    }

    if (!row.buy_unit) {
        throw new Error(`Row ${row.__rowNumber}: buy_unit is required.`);
    }

    if (!row.store_unit) {
        throw new Error(`Row ${row.__rowNumber}: store_unit is required.`);
    }

    if (!Number.isFinite(conversionFactor) || conversionFactor <= 0) {
        throw new Error(`Row ${row.__rowNumber}: conversion_factor must be a number greater than 0.`);
    }

    if (!Number.isFinite(price) || price < 0) {
        throw new Error(`Row ${row.__rowNumber}: price must be a number greater than or equal to 0.`);
    }

    if (!restaurantId) {
        throw new Error(`Row ${row.__rowNumber}: restaurant_id is required, either in the CSV or with --restaurant-id.`);
    }

    return {
        name: row.name,
        buy_unit: row.buy_unit,
        store_unit: row.store_unit,
        conversion_factor: conversionFactor,
        price,
        restaurant_id: restaurantId
    };
}

async function insertRows(rows) {
    const supabaseUrl = process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_KEY || DEFAULT_SUPABASE_KEY;

    const response = await fetch(`${supabaseUrl}/rest/v1/main_store`, {
        method: 'POST',
        headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
        },
        body: JSON.stringify(rows)
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase insert failed (${response.status}): ${text}`);
    }

    return response.json();
}

async function main() {
    const args = parseArgs(process.argv.slice(2));

    if (!args.csv) {
        throw new Error('Usage: node scripts/import-main-store.mjs --csv <file> [--restaurant-id <uuid>]');
    }

    const csvPath = path.resolve(process.cwd(), args.csv);
    const csvText = await fs.readFile(csvPath, 'utf8');
    const parsedRows = parseCsv(csvText);
    const rows = parsedRows.map((row) => normalizeRow(row, args.restaurantId));
    const inserted = await insertRows(rows);

    console.log(`Inserted ${inserted.length} row(s) into main_store.`);
}

main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
});
