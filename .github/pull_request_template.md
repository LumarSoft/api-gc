## Qué cambia

<!-- Qué hace la PR y por qué, en pocas líneas. -->

## Pasos después de mergear

<!--
Lo que cada dev y el deploy tienen que hacer para que esto funcione. Marcá lo que aplique y borrá el resto.
Cada paso manual va también arriba de todo en docs/upgrade-notes.md y, si se puede, como check en scripts/doctor.mjs:
así los hooks de git y el doctor se lo muestran a todos después del pull.
-->

- [ ] Ninguno
- [ ] **Migración** — dev: `npx prisma migrate dev && npx prisma generate` · prod: `npx prisma migrate deploy` antes de
      levantar el build (si falta, la API no arranca y lo dice)
- [ ] **Variables de entorno nuevas** (en `.env.example`): …
- [ ] **Dependencias nuevas** → `npm install`
- [ ] **Seed / script a correr**: …
- [ ] **Configuración del servidor** (Nginx, PM2, storage…): …
- [ ] **Orden de deploy**: …

## Verificación

<!-- lint, test, build, e2e; qué probaste a mano. -->
