# Proposed Type 3 operations metadata

Run the repository's pinned compiler explicitly:

```sh
.validation-tools/bin/forgec check forge-type3
.validation-tools/bin/forgec build forge-type3 --target cloudflare
```

These declarations are NOT wired to the executable research snapshot tables and are not claimed validated until the above commands pass for this exact commit. They are design-time configuration records, not APIs used by the local workbench. No source clinical tables are generated here.

A later ownership cutover must reconcile generated validation, auth, APIs, schema and migrations in one reviewed change. Do not deploy both manual and generated owners to the same tables. `clinicalUseAllowed` is illustrative metadata here, not an authorization control: the actual research API hardcodes false and has no clinical-enablement action.
