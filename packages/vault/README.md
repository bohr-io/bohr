# @bohr/vault

Envelope encryption for the credentials a bohr instance stores (Cloudflare tokens, the GitHub App key, signing keys).

Each value gets its own random AES-256-GCM data key, wrapped by a master key. The `context` passed to `seal` and `open` is authenticated data: it binds a value to where it is stored, so a ciphertext copied to another row does not decrypt.

```ts
const vault = new Vault(parseMasterKeys(env.ENCRYPTION_KEY));
const sealed = await vault.seal(token, `cf_connection:${id}`);
const token = await vault.open(sealed, `cf_connection:${id}`);
```

## Rotation

`ENCRYPTION_KEY` holds one base64 key, or several as `id:key,id:key` with the current one first. New values are sealed with the current key; older values open with whichever key sealed them, and `rewrap` moves them to the current key. Remove an old key only after every value was rewrapped. Values sealed by earlier versions straight under the master key (`v1.`) are still read with any configured key.
