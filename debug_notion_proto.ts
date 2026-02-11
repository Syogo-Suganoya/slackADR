import { Client } from '@notionhq/client';
const notion = new Client({ auth: 'abc' });
console.log('notion.databases Prototype:', Object.getPrototypeOf(notion.databases));
console.log('notion.databases Prototype Keys:', Object.getOwnPropertyNames(Object.getPrototypeOf(notion.databases)));
console.log('notion.databases Query Type:', typeof (notion.databases as any).query);
