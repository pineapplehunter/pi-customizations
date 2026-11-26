# Review inbox

Ask Pi to use the **browser review inbox** for an asynchronous grill-me round or
for reviewing several items. Pi adds one card per `review_request` call and
shares the inbox link. Open it while Pi is still running; the agent doesn't
need to wait or poll. `review_list` retrieves saved cards and opens the browser
inbox again if any are still unanswered.

A card can have Markdown context, single-select choices (including labels such
as **Approve** and **Request changes**), and local PNG, JPEG, or WebP attachments.
Pick a choice, write your own answer, or do both, then select **Done**. Pi wakes
up or receives the answer at its next steering point. You can add comments to
answered cards while any card remains unanswered. Saving the final answer shuts
down the server. You can leave the browser tab open: it reconnects automatically
when the server starts for the next review. The **Theme** menu lets you choose
System, Light, or Dark.

Pi can call `review_update` with a `card_id`, Markdown `body`, and optional
`options` to ask a follow-up on the same card. Rounds appear oldest first, each
with its own replies. Only the newest round accepts input, and choices are
never inherited. A replaced unanswered round is marked **Superseded**.

Pi can call `review_retract` with a card's `card_id`, even after you answer it.
The card is marked **Retracted** and moves to **Resolved**. Existing replies
stay in place. While the inbox is open, you can add a text comment that notifies
Pi without reopening the card. If no cards need a response, the server stops.

The inbox is private to the current Pi conversation and survives restarts
under `/tmp/pi-review-<uid>/` until the OS cleans it up. Use one Pi process per
conversation. `/review-clear` confirms before deleting that conversation's
cards, replies, and copied images. It doesn't alter the chat transcript.

The TypeScript server runs inside the Pi process, not as a separate daemon,
and listens only on `127.0.0.1`. Pi shows the port in the transcript when the
server opens or closes. Open `http://localhost:PORT` in your browser; there is
no login or access token. The conversation keeps the same port across server
stops, inbox clears, and Pi restarts while its `/tmp` state exists. If another
process takes that port while the server is stopped, free it and try again.
For a remote Pi session, forward the displayed port
(replace `PORT` and `HOST`), then open the same URL in your local browser:

```sh
ssh -N -L 127.0.0.1:PORT:127.0.0.1:PORT HOST
```

Run `pi-update --local /path/to/pi-customizations` and restart Pi. The updater
uses Pi's package installer to install the server's Node dependencies. No
separate setup is needed. Rebuild and activate the updated Home Manager/NixOS
configuration first if you still have the old updater.

The browser loads Tailwind from jsDelivr. The inbox and replies still work
without CDN access, but the page is unstyled. The extension does not bundle
or build third-party assets. For development and tests in the checkout, run
`npm install --legacy-peer-deps`.
