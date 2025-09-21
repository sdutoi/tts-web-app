// Local script to verify the currently loaded key against both models and responses endpoints.
import 'node:process';

const key = (process.env.OPENAI_API_KEY || '').trim();
if (!key) {
  console.error('No OPENAI_API_KEY in env');
  process.exit(1);
}
console.log('Key length:', key.length, 'prefix:', key.slice(0,10), 'suffix:', key.slice(-6));

async function test(url, body) {
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await resp.text();
  return { status: resp.status, snippet: text.slice(0,200) };
}

const models = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${key}` } });
console.log('GET /models =>', models.status);
console.log('models snippet:', (await models.text()).slice(0,200));

console.log('\nPOST /chat/completions');
console.log(await test('https://api.openai.com/v1/chat/completions', { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'ping' }], max_tokens: 4 }));

console.log('\nPOST /responses');
console.log(await test('https://api.openai.com/v1/responses', { model: 'gpt-4o-mini', input: 'ping' }));
