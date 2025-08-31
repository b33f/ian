---
title: 🧑‍⚖️ FIPS is compliance not security
summary: Do not use FIPS expecting stronger security
date: 2025-08-29

# Featured image
# Place an image named `featured.jpg/png` in this page's folder and customize its options here.
image:
  caption: 'Cow Scientist and Security'

authors:
  - admin

tags:
  - FIPS
  - Encryption
  - HIPAA
  - FedRAMP
  - Compliance
---

## FIPS Background

If you have ever waded into the alphabet soup of government regulations, you have probably stumbled across FIPS. FIPS stands for [Federal Information Processing Standards](https://www.nist.gov/itl/publications-0/federal-information-processing-standards-fips). These are cryptographic standards developed and maintained by the US government. In particular, FIPS 140-2 and the newer FIPS 140-3 define how cryptographic modules should be validated.  

Who actually cares about this? Federal agencies do. Defense contractors do. Healthcare organizations dealing with HIPAA do. Anyone chasing FedRAMP certification does. In short, if you want to work with Uncle Sam or play in industries where compliance checklists reign supreme, you care about FIPS. If you are not in one of those camps, the only reason you might hear about FIPS is when someone accidentally enables "FIPS mode" on a Windows laptop and suddenly half their apps stop working.

## The Myth: Stronger Security

It is tempting to think that FIPS is like a superhero cape for your cryptography. Flip the switch, enable FIPS, and boom, you are protected with the strongest algorithms known to humankind. Sadly, that is not how it works.

Take ChaCha20-Poly1305, which is an encrpytion algorithim that is often used in TLS and other secure protocols. This algorithm is endorsed by cryptographers, developers, and performance engineers alike. It provides confidentiality, authenticity, and when hardware acceleration is not in play, it can even beat the widely used AES in speed. But here is the catch: ChaCha20-Poly1305 is not approved for FIPS. So if you are stuck in FIPS land, you cannot touch it. Your "more secure" algorithm of choice is off limits simply because it has not been stamped by the FIPS committee.

## Not Insecure, Just Bureaucratic

Now, to be fair, FIPS is not insecure. The algorithms that get through the approval process are safe. You are not walking around with a giant bullseye on your data if you are using AES under FIPS. The real issue is that FIPS is developed by committee in the US government, which is not exactly famous for moving quickly.  

Picture a cryptography conference where researchers are excitedly sharing the latest post-quantum crypto breakthroughs. Then picture a government committee politely nodding, taking notes, and saying "we might look at that in 5 to 10 years." By the time FIPS adopts new algorithms, the rest of the industry has already been using them for years.

## Microsoft’s Friendly Warning

Even Microsoft tries to save people from unnecessary pain. They specifically advise against enabling FIPS mode on Windows unless you absolutely must. Why? Because it can slow down performance and break software that relies on non-FIPS algorithms. Imagine someone adding a self-driving mode to a Ferrari and then complaining it is not a fun car anymore. That is what happens when you flip on FIPS mode for no reason.  howtogeek.com has a great [article](https://www.howtogeek.com/245859/why-you-shouldnt-enable-fips-compliant-encryption-on-windows/), explaining the issues that FIPS mode causes in Windows.

## Where FIPS Actually Helps

FIPS does shine in one area: compliance. For example, HIPAA has a neat carve-out. If protected health information is encrypted with a FIPS approved algorithm and the keys are safe, the data is considered "secured." That means if someone breaks in and steals the encrypted data, you do not have to send out breach notifications to patients, HHS, or the media. In other words, FIPS can save you from a public relations nightmare. That is less about math and more about paperwork, but paperwork is a big deal when regulators are involved.

## The Real Takeaway

If your organization has compliance requirements like HIPAA, FedRAMP, or government contracts, then yes, you need FIPS. It is your golden ticket to passing audits and avoiding regulatory headaches. But if you are chasing stronger, faster, or more modern security, FIPS is not your answer. In fact, it might hold you back.

**Use FIPS when compliance requires it. Do not use FIPS expecting stronger security.**  
Consistency and checkboxes are the real purpose of the standard. The strongest security is usually found outside of it.
