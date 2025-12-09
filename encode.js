import fs from 'fs';

const key = fs.readFileSync('./firebase-admin.json');
const base64 = Buffer.from(key).toString('base64');
console.log(base64);
