---
chapter: 4
order: 15
role: demo
tags: [autogallery, profile, import]
---

# Import and Export

> Template rules live in `.json` or `.js` files and are imported from "Configuration management" in the settings page. An import is an overwriting update validated as a whole: either everything lands, or nothing changes.

## File format

```json
{
  "id": "wide",
  "name": "wide",
  "floatAlignment": "alternate",
  "rules": [
    { "ratioRange": "[0.75,1.35]", "width": 0.68, "layout": "auto", "side": "auto" },
    { "ratioRange": "(1.35,5]", "width": "0.55 + 0.1 * Math.log(r)", "layout": "auto", "side": "auto" },
    { "ratioRange": "[0.2,0.75)", "width": "Math.max(0.32, 0.3 + 0.2 * r)", "layout": "float", "side": "left" }
  ]
}
```

Save this snippet as a `.json` file, then select it under "Configuration management → Import profile" in the settings page. The file may also hold an array, to import several templates at once.

`id` may be omitted; when it is, the file name is used. An empty `rules` array is treated as `auto`.

## Overwriting update

| Case | Result |
| --- | --- |
| Same `id` as an existing template | The whole template is replaced |
| Templates not mentioned in the file | Left untouched |
| `id` set to the built-in `auto` | Always skipped, never overwritten |
| Rule count silently dropped | Check the count on the settings page after importing |

The last row deserves a note of its own: **invalid rules that were already stored in the profile are silently dropped**, rather than raising an error. So after an import finishes, look over the same panel and check whether the rule count matches the file; if it is short, some expression failed validation.

## Whole-file validation

If any single template is invalid, the entire file is rejected and no setting is partially written. This rules out the state of "half imported — the first two took effect, the last two did not".

## External profile file

The `externalProfilePath` setting can point at a profile file outside the vault. It fits the case where "templates follow the team repository rather than the personal vault":

- The path may be absolute, or relative to the vault root.
- If the file is missing or cannot be read, the plugin falls back to the last successfully imported profile and does not clear your templates.
- On export you can either write to this path, or download straight into the system download folder.

## Export

"Export all" writes every current template into one file, in exactly the same format as import — so you can take an exported file, edit it as a template, and import it back.

## Related

- What the rules mean: [[14-layout-templates]]
- Matching and priority: [[16-routing]]

---

Previous · [[14-layout-templates]] ｜ [[README|Contents]] ｜ Next · [[16-routing]]
