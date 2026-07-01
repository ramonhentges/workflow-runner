# Step Model Variant Specification

## Goal

Allow each workflow step to optionally select the model's ACP thought/reasoning level while preserving the agent's default when no variant is configured.

## Assumptions

- The workflow JSON field is named `variant`.
- Variant values are provider-defined strings rather than a fixed enum.
- An explicitly configured variant must not be silently ignored when the agent cannot apply it.

## Acceptance Criteria

- **SMV-01**: WHEN a step contains a non-empty `variant` string THEN the workflow loader SHALL retain that exact value on the step.
- **SMV-02**: WHEN a step omits `variant` THEN workflow loading and session setup SHALL succeed without calling `session/set_config_option`, preserving the agent's default.
- **SMV-03**: WHEN a configured step starts and the agent advertises a select config option categorized as `thought_level` THEN session setup SHALL set that option to the step's exact `variant` value after selecting the model.
- **SMV-04**: WHEN a configured step's agent does not advertise a thought-level option or rejects the value THEN session setup SHALL fail with an error naming the step and variant.
- **SMV-05**: WHEN an author enters a model variant in the workflow editor THEN the editor SHALL save and reload the exact value for that step.
- **SMV-06**: WHEN the editor's model variant field is blank THEN the saved step SHALL omit `variant`.

## Out of Scope

- Defining a universal set of variant values across IDEs/providers.
- Extending IDE catalog discovery with thought-level options.
- Changing model or agent selection behavior.

## Verification

- Domain tests cover configured, omitted, and invalid variant input.
- ACP profile tests cover configured calls, omitted calls, unsupported agents, and rejected values.
- Editor schema/component tests cover exact round-trip and blank omission.
- Full repository and web gates pass, followed by a scratch mutation sensor.
