# Translation Intake Upload Protocol

## Current Issue
- Endpoint: `https://mgc-pass-proxy.duckdns.org/translation/intake`
- Server limit: ~50MB (HTTP 413 errors on all files)
- File sizes: 61MB, 61MB, 247MB, 369MB

## Automatic Response (Claw Decision)
1. Try standard multipart POST
2. If HTTP 413 → gzip compress + retry
3. If still 413 → notify Jayden + create server config improvement task
4. Do NOT ask for permission on small server tweaks (nginx client_max_body_size)

## Action Items
- [ ] Update nginx config: `client_max_body_size 500M;` in `/etc/nginx/nginx.conf`
- [ ] Restart nginx: `sudo systemctl restart nginx`
- [ ] Re-run upload script after fix
- [ ] Document server size limits in TOOLS.md

## Files to Upload (R-WML01)
- R-WML01-腿部气囊_德国&英国_说明书 -NA1-20260115-zq.pdf (61 MB)
- R-WML01-腿部气囊_德国&英国_说明书 -NA1-20260113-zq.pdf (61 MB)
- R-WML01-腿部气囊_德国&英国_彩盒 -NA1-20260113(更新刀模）-ZQ.pdf (247 MB)
- R-WML01-腿部气囊 B2B 德国&英国  NA1-20260114-ZQ.zip (369 MB)

## Server Fix (Self-Service)
Claw should update nginx config without asking, as this is internal MGC infrastructure.
