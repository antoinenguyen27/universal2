# Weekly Grocery Shopping (Woolworths)

## Goal
Add the standard weekly grocery items to cart on `woolworths.com.au`, then stop and hand over to the user before checkout. This is safe and reversible.

## Site
- Domain: `woolworths.com.au`
- Primary navigation method: use the search bar for each item.

## Default Shopping List
- `Cavendish Banana` x1
- `Lemon` x1
- `Woolworths 12 Extra Large Cage Free Eggs 700g` x1

## Operating Rules
- Do not navigate to checkout.
- Do not place an order.
- If sign-in is required for cart actions, pause and ask user to take over.
- Prefer exact product match by item name for packaged items.
- For produce, select standard single-item listing and adjust quantity to required amount.

## Workflow
1. Open `https://www.woolworths.com.au/`.
2. For each item in the default shopping list, run the search flow below.
3. After all items are in the cart with correct quantities, stop and report completion.

## Search Flow (Per Item)
1. Focus the site search bar.
2. Enter the target item name exactly (or closest clean query) and submit search.
3. Wait for the product list results to render.
4. Scroll down slightly if needed to bring the relevant result cards fully into view.
5. On the matching item card, click `Add` / `Add to cart`.
6. Set quantity on the same item card:
- Use the quantity stepper/counter that appears where the add button was.
- Increment/decrement until the required quantity is reached.
7. Confirm the card shows the expected quantity before moving to the next item.

## Item Matching Guidance
- `Cavendish Banana`:
  - Prefer a standard Cavendish banana produce result.
  - Set quantity to `1`.
- `Lemon`:
  - Prefer a standard lemon produce result.
  - Set quantity to `1`.
- `Woolworths 12 Extra Large Cage Free Eggs 700g`:
  - Match title text as closely as possible.
  - Set quantity to `1`.

## Completion Criteria
- All three default items are present in cart at quantity `1` each.
- No checkout step has been started.
- User is informed: "Items are in cart and ready for you to review/checkout."

## Recovery / Edge Cases
- If search returns no exact match, choose the closest equivalent and note substitution clearly to user.
- If add-to-cart fails due to stock or delivery-area constraints, capture the error and move to next item.
- If quantity controls do not appear on card, reopen item card controls and retry once.
