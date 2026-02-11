import { Client } from '@notionhq/client';
const notion = new Client({ auth: 'abc' });
console.log('notion keys:', Object.keys(notion));
console.log('notion.databases:', typeof notion.databases);
if (notion.databases) {
    console.log('notion.databases keys:', Object.keys(notion.databases));
}
