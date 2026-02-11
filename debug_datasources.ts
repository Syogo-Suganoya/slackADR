import { Client } from '@notionhq/client';
const notion = new Client({ auth: 'abc' });
console.log('notion.dataSources:', typeof (notion as any).dataSources);
if ((notion as any).dataSources) {
    console.log('notion.dataSources keys:', Object.keys((notion as any).dataSources));
}
