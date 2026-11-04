# Proposed Type 3 operations metadata

Run the repository's pinned compiler explicitly:

```sh
.validation-tools/bin/forgec check forge-type3
.validation-tools/bin/forgec build forge-type3
```

The pinned 0.5.0 CLI accepts `build <PATH>` without a `--target` flag. These declarations are NOT wired to the executable research snapshot tables. Check/build success validates the design-time contract, not live schema ownership or clinical suitability. No source clinical tables are generated here.

A later ownership cutover must reconcile generated validation, auth, APIs, schema and migrations in one reviewed change. Do not deploy both manual and generated owners to the same tables. `clinicalUseAllowed` is illustrative metadata here, not an authorization control: the actual research API hardcodes false and has no clinical-enablement action.
