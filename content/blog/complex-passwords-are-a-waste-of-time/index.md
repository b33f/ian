---
title: 🔒 Complex passwords are a waste of time
summary: Believe it or not, a strong password does not really secure your online accounts
date: 2023-08-18

# Featured image
# Place an image named `featured.jpg/png` in this page's folder and customize its options here.
image:
  caption: 'Passwords in Space'

authors:
  - admin

tags:
  - Passwords
  - MFA
  - Passkey
  - Passwordless
  - Threats
---

## The Power of Passphrases: A Better Approach to Password Security
The conventional advice for passwords to use a complex string of random characters, but this is nonsense! Unreadable random characters will cause people to use short passwords like *P@55w0rd!*, or even worse write them down on a sicky note attached to the monitor.

The strength of a password is measured in bits of entropy, which quantifies the randomness and unpredictability of the password.

Which is the stronger password ?

**g72$l#pT9a** or **..CAT...................**

The longer password, even one using a smaller character set, can provide significantly more entropy than a short, complex one. This is because the entropy calculation is exponential, with password length having a greater impact than character set size.  This is a silly example and using a single dictionary word isn't reccomended.

An actual effective and memorable approach to password creation is to use a long passphrase composed of multiple random words, ideally separated by special characters.  Many password managers will be able to auto generate these for you.

The following table demonstrates how a long passphrase can provide more security than a standard complex password, based on a simple entropy calculation.

|Password Example              | Length | Character Set                     | Bits of Entropy |
| ------------------------     | ------ | ------------                      | --------------- |
| P@55w0rd!                    | 9      | 82 (upper, lower, digit, special) | ~59 bits  |
| g72$l#pT9a                   | 10     | 82 (upper, lower, digit, special) | ~66 bits  |
| ..CAT....................    | 25     | 49 (upper, special)               | ~140 bits |
| correct-horse-battery-staple | 28     | 37 (lower, digit, hyphen)         | ~146 bits |
| 4Turtles!all\^the\^way\^down | 25     | 82 (upper, lower, digit, special) | ~164 bits |

There are instances where a strong password is required, such as for a password manager's master password. The truth is, passwords don't matter as much as most people think.

The major cyberattacks that we read about in the media are not caused by brute force attacking passwords, but about stealing them for direct access to accounts. So no matter what password complexity rules you follow, it doesn't matter. It's still important to use unique passwords, but instead of focusing on creating the perfect password, we should be focusing on using multi-factor authentication (MFA) and ensuring that great threat detection is in-place to truly protect our accounts.

Microsoft research, based on actual threats to their massive Azure cloud architecture, explains this concept really well in their blog post [Your Pa$$word doesn't matter](https://techcommunity.microsoft.com/blog/microsoft-entra-blog/your-paword-doesnt-matter/731984)

It's also worth mentioning that the newer [FIDO passkey technology](https://fidoalliance.org/passkeys/), which has been adopted by major tech players, builds in MFA, can be used in a passwordless model, and is far far more secure than using passwords.