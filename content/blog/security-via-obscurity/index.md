---
title: 🚪🔑 Security through Obscurity, a Trap-Door
summary: An outdated idea that fails time and time again.
date: 2025-08-20

# Featured image
# Place an image named `featured.jpg/png` in this page's folder and customize its options here.
image:
  caption: ''

authors:
  - admin

tags:
  - Zero Trust
  - MFA
  - VPN
  - Backdoor
  - Encryption
---

# Why I Hate Security through Obscurity

I am not shy about this opinion. Security through Obscurity (StO) is the security equivalent of hiding a key to your house under the welcome mat and then being surprised when someone finds it. I hate security that depends on secrecy alone. I hate closed source secret protocols and proprietary encryption that you cannot audit. While I'm at it, I also hate relying on VPNs as if they are magical walls.


I love open standards, fully audited code and zero trust principles that treat identity and device posture as the things that actually matter.  Whenever I can, I make this a purchasing decision and support products or services that align with my thinking.  I just wish it was simple to indentify the vendors who are doing this.

## Short version
* Security that depends on secrecy fails spectacularly when the secret leaks or when the vendor decides to cooperate with intelligence services.
* Closed systems make it impossible for independent experts to find and fix real bugs.
* Replace secret perimeters with identity and device checks with continuous evaluation, only then do you actually get secure access.

## Why obscurity is a rotten design principle
Obscurity is not a feature. It is a brittle assumption. If your design assumes that attackers will not know how your system works, then the moment they do know, everything collapses. Attackers do not need to break math when they can break process, trust, or supply chain. Proprietary protocols, secret key material kept in a vendor black box and single point trust models concentrate risk into a single failure mode. When that fails the blast radius is often global.

## Famous failures of secrecy and proprietary trust

**SS7 and the illusion of secure telecom**
Signaling System 7 (SS7) is the ancient plumbing that allows global mobile phone networks to operate. It was designed in the 1970s and never built with modern security in mind. One of the main weaknesses is that it assumes trust between carriers. That trust has been [abused for interception](https://www.eff.org/deeplinks/2024/07/eff-fcc-ss7-vulnerable-and-telecoms-must-acknowledge) of calls and SMS, including two step verification codes used in MFA. When signaling trust is the only thing protecting messages, attackers who can access the signaling network can intercept authentication messages and more.

**Crypto AG and the classic backdoored black box**
Crypto AG sold encryption machines to governments around the world. For decades some of those machines [contained weaknesses that intelligence agencies exploited](https://www.theguardian.com/us-news/2020/feb/11/crypto-ag-cia-bnd-germany-intelligence-report). Customers bought a closed black box and assumed confidentiality. The lesson is brutal and simple, the vendor can willingly or unknowingly bake in access for third parties and the buyer has no independent way to verify real security.

**Dual EC and how a standard can become a trap**
Sometimes the danger is not a vendor but a standard that looks official. The Dual EC random generator was published as an approved option in standards and later shown to be [suspect as a way to allow a party who knew a secret value to predict supposedly random numbers](https://blog.cloudflare.com/how-the-nsa-may-have-put-a-backdoor-in-rsas-cryptography-a-technical-primer/). When standards or default libraries put weak choices in front of users, those defaults become a vector for mass compromise.

## Why VPNs hide poor security design
A Virtual Private Network (VPN) gives you network level access. That is fine when you actually need it, but it is a blunt instrument. A VPN treats the network as a trust boundary and often implicitly grants broad lateral movement once you are in. Compromised credentials or vulnerable VPN appliances become keys to an entire castle. Zero trust replaces that old model by enforcing access per application and per resource based on identity, device posture and context rather than granting broad rights just because someone connected over a tunnel.

## Why I love open source and audits
Open source does not magically mean secure. But open source lets independent experts audit, test and improve code. Transparency enables reproducible builds, supply chain scrutiny and faster detection of vulnerabilities. When cryptography, libraries and critical infrastructure are public, anyone can evaluate the math and the implementation. That is the opposite of trusting a black box because someone told you to.

## Google BeyondCorp
Google shifted the company away from perimeter based access toward a model now known as BeyondCorp. The core idea is simple and profound, do not trust the network by default. Instead require that every access request is evaluated based on who the user is, the device they are using and contextual signals such as location and risk data. BeyondCorp moves access control from the network edge to per resource policies that are enforced continuously.

### How BeyondCorp works
* Replaces VPN based network access with identity and device based access to applications.
* Enforces per resource policies so users only get the minimal privilege required for the task.
* Checks device inventory and device posture as part of every access decision.
* Reduces lateral movement because access is scoped per application not per network segment.

A simple policy flow example in normal words:
1. User requests access to an internal app.
2. An access proxy asks the identity provider who the user is and checks the device record for posture.
3. The system evaluates a policy that might require multi factor, device patch level and a role check.
4. If everything passes the proxy allows access to the app for only the required session and logs the event for auditing.

The practical benefits are fewer support headaches for remote workers, stronger auditing and much tighter control over who can access what and when.

## Cloudflare Zero Trust architecture explained
Cloudflare approaches zero trust by placing its global network as an enforcement plane and offering modular services that together replace legacy perimeter controls. Their offering bundles secure access to internal applications with secure web gateway functions and device posture checks as a single control plane. In practice that can include identity based access for applications, a secure gateway to the public web for users and integration with endpoint posture signals.

### Core components to know
* Access proxy that evaluates identity and device posture before granting access to an app.
* Secure gateway functions that filter and inspect outbound web traffic for data loss and threat containment.
* A global enforcement network that minimizes latency while applying policies close to the user.

The benefit is unified logging, consistent policy and the ability to apply controls at scale across many locations and many application types.

## Practical recommendations you can use today
* Prefer open source cryptography libraries that are actively audited and widely used.
* Avoid SMS for multi factor auth (MFA) wherever possible because signaling networks can be easily attacked. Use app based authenticators or even better use hardware tokens for account access.
* Move away from broad network access based on tunnels and toward per application access based on identity and device posture.
* Build a device inventory and automate posture checks as part of every access decision.
* Treat standards and defaults with healthy suspicion, and allow independent review of anything that touches secrets.

## Parting rant and cheer
I will say it again and then I will go enjoy a coffee. Security through obscurity is lazy design dressed up as prudence. If your threat model relies on keeping the implementation secret then you will fail eventually. Design systems that remain safe when their internals are known. That is how we build resilient systems. That is why I love open source and zero trust. That is why I hate the welcome mat trick.

Stay skeptical, audit the code, trust the math and do not trust the mat.
