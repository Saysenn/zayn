const archiver = require('archiver');
const { FIXED_DATE } = require('./scrubWorkbook.helper');

// ***************************************************
// * Named files -> one finished zip, in memory
// ***************************************************
//
// A BROWSER WILL NOT ACCEPT SEVERAL DOWNLOADS FROM ONE CLICK: it silently
// drops all but the first. Anything producing a file per group has to hand
// back one archive.
//
// EVERY ENTRY CARRIES A FIXED TIMESTAMP, never "now". A zip stamps each
// file with the moment it was added, which would make the archive say to
// the second when it was generated: exactly the tell `scrubWorkbook` is
// already cleaning out of the xlsx files inside it. 1980 is the earliest
// the zip format can represent, and it is the same instant the workbook
// properties claim, so the two cannot disagree.
//
// FORMAT AGNOSTIC ON PURPOSE. It knows nothing about the master sheet or
// about expenses; it takes named buffers. Two exports may share this
// without either being able to read the other's file.

const ZIP_ENTRY_DATE = FIXED_DATE;

/** @param {{name: string, body: Buffer}[]} files */
function zipBuffer(files) {
  return new Promise((resolve, reject) => {
    const zip = archiver('zip', { zlib: { level: 9 } });
    const chunks = [];
    zip.on('data', (c) => chunks.push(c));
    zip.on('error', reject);
    zip.on('end', () => resolve(Buffer.concat(chunks)));
    for (const f of files) zip.append(f.body, { name: f.name, date: ZIP_ENTRY_DATE });
    zip.finalize().catch(reject);
  });
}

module.exports = { zipBuffer, ZIP_ENTRY_DATE };
