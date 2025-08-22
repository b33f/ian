---
title: 🛑 Stop using (the acronym) SSL
summary: It was replaced over 25 years ago by TLS
date: 2025-08-21

# Featured image
# Place an image named `featured.jpg/png` in this page's folder and customize its options here.
image:
  caption: 'TLS crushes SSL'

authors:
  - admin

tags:
  - Encryption
  - SSL
  - TLS
  - Rant
---

# Stop Calling it SSL. Seriously

Yes you read that title right. If you are writing SSL in 2025 you are doing it wrong. That polite little acronym stuck around as a habit long after the protocol it named moved on. It is time to speak clearly and call things by their actual name which is TLS. All versions of SSL are now deprecated and should no longer be used.

## A short history of SSL and what it did

Back in the early web era a company called Netscape built a protocol to make web conversations private and authenticated. Early versions had serious flaws and evolved rapidly. The public milestones were SSL version 2 in the mid 1990s and SSL version 3 about a year later. The goal was simple and elegant: let a browser and a server agree on keys and then encrypt and authenticate application data so passwords and payment details did not travel the wire in plain text.

## Why TLS exists and how the name changed

When the IETF took the work on as an open standard the protocol was revised and renamed. The first IETF version was TLS version 1.0 which grew out of SSL 3.0 in 1999 ! The rename was as much political and procedural as it was technical. The protocol authors made changes and chose the new name so the work would clearly be seen as an IETF standard rather than a vendor specific spec.

## What people usually mean by SSL

Most of the time when someone writes SSL they mean one of these things

1. The cryptographic protocol that makes an encrypted channel between a client and a server
2. The certificate that a website presents so a browser can verify identity
3. A secure web connection as seen in a browser address bar

All three of those uses are reasonable shorthand but the precise reality is that modern systems use TLS and not SSL. When you mean the protocol say TLS. When you mean the certificate say TLS certificate or digital certificate.

## The technology did not stop evolving

TLS kept evolving with clearer security goals and stronger defaults. There have been multiple versions and the most recent major update is TLS version 1.3 which improved both security and performance. Older protocol versions were gradually deprecated as attacks and cryptanalysis made them unsafe to rely on in production.

## Practical style rules you can adopt right now

1. If you write documentation or a blog post use TLS instead of SSL
2. If you are naming a config option or a variable prefer tls over ssl so new readers are not confused
3. When you talk to colleagues correct gently and explain that TLS is the current name and that TLS is what browsers and servers implement now

If you do this we will collectively make future searches and debugging sessions less noisy and more accurate. That is a win for security and a win for clarity.

## Closing plea from one nitpicker to another

Language shapes how engineers think about systems. Saying the right protocol name helps people notice when they are running an old, insecure version. Stop typing SSL out of habit and use TLS instead. Your future self will thank you and so will the internet
