# Add and name a new slide — Google Slides

type: atomic
site: slides.google.com
confidence: high
created: 2026-03-02

## Intent
Adds a blank slide and names it immediately.

## Preconditions
- A Google Slides presentation is open.
- The slides panel is visible.

## Actions
1. intent: "Add a new blank slide"
   element: "New slide button in the main editing toolbar — creates a new blank slide after the current slide"
   act_hint: "Click the New Slide button in the top toolbar"

2. intent: "Set title"
   element: "Title text field on the new slide — editable text area labelled 'Click to add title'"
   act_hint: "Double-click the title placeholder and type the requested title"

## Self-Healing
If the New Slide button is missing, use Insert > New slide.

## Notes
User prefers add-then-name as a single rhythm.
