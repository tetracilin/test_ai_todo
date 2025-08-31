

const serialize = (value: any): string => {
    if (value === null || value === undefined) return '""';
    
    let str: string;
    if (typeof value === 'object') {
        str = JSON.stringify(value);
    } else {
        str = String(value);
    }
    
    str = str.replace(/"/g, '""');
    
    return `"${str}"`;
};

export const toCSV = (data: any[], headers: string[]): string => {
    const headerRow = headers.join(',');
    const rows = data.map(obj => 
        headers.map(header => serialize(obj[header])).join(',')
    );
    return [headerRow, ...rows].join('\n');
};

const deserialize = (value: string): any => {
    if (value === null || value === undefined) return null;

    if (value === 'true') return true;
    if (value === 'false') return false;
    
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    
    try {
        if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
            return JSON.parse(value);
        }
    } catch (e) {
        // Not valid JSON, return as string
    }

    return value === '' ? null : value;
};


function parseCsvRow(row: string): string[] {
    const values: string[] = [];
    const regex = /(?:"((?:[^"]|"")*)"|([^,]*))(?:,|$)/g;
    let match;

    // Ensure the regex resets its index
    regex.lastIndex = 0;

    while (match = regex.exec(row)) {
        if (match.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        let value = match[1] !== undefined ? match[1].replace(/""/g, '"') : (match[2] || '');
        values.push(value);
    }
    
    // Handle case where row ends with a comma
    if (row.endsWith(',')) {
        values.push('');
    }

    return values;
}


export const fromCSV = (csvText: string, expectedHeaders: readonly string[]): any[] | { error: string } => {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 1) return { error: "CSV is empty or contains only a header." };

    const headers = parseCsvRow(lines[0]).map(h => h.trim());
    
    if (headers.length !== expectedHeaders.length || !headers.every((h, i) => h === expectedHeaders[i])) {
        return { error: `Invalid headers. Expected: ${expectedHeaders.join(',')}. Found: ${headers.join(',')}` };
    }

    const data = [];
    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCsvRow(lines[i]);

        if (values.length !== headers.length) {
            console.warn(`Skipping malformed row ${i + 1}: expected ${headers.length} values, found ${values.length}. Row content: ${lines[i]}`);
            continue;
        }

        const obj: { [key: string]: any } = {};
        for (let j = 0; j < headers.length; j++) {
            obj[headers[j]] = deserialize(values[j]);
        }
        data.push(obj);
    }
    return data;
};