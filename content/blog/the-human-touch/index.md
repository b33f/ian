---
title: 👥 ⛓️ Social Engineering & Phishing in a AI powered world
summary: Why Humans Are Often the Weakest Link in Cybersecurity
date: 2025-08-19

# Featured image
# Place an image named `featured.jpg/png` in this page's folder and customize its options here.
image:
  caption: 'People Holding Hands, Spiders'

authors:
  - admin

tags:
  - AI
  - LLM
  - Passwords
  - Threats
  - Social Engineering
  - Phishing
  - Ransomware
  - Scattered Spider
---

# Why Humans Are Often the Weakest Link in Cybersecurity

## 1. Evolving Tactics
Cybercriminals are increasingly sophisticated. Rather than relying on obvious exploits, attackers use social engineering (phishing, voice manipulation, SIM swapping, etc) to trick trusted individuals into helping them with their attacks.

## 2. Advanced Phishing Techniques, hypercharged with AI
- **Spear-phishing**: Highly targeted emails that mimic trusted contacts or organizations. This technique has been used for decades, but the difference now is you can no longer look for obvious typos or unusual words and phrases in the email.  AI tools can accurately replicate any individual's writing style and they are able to help non-native english attackers avoid the usual language mistakes that were a common red-flag.
- **Voice phishing (vishing)**: Attackers call help desks or employees, impersonating legitimate staff to reset passwords or MFA. With modern AI tools it is possible to simulate someone's voice with very little source material to train on, so this attack works even if the victim's voice is known to the reciever of the call.  More advanced attackers are even making deep-fake avatars that can fool employees on a very realistic video call !
- **SIM-swapping & MFA fatigue**: Social manipulation techniques that weaken authentication safeguards.  An AI chatbot can interact with a telecom provider's support chat capability in a realistic human manner, tricking them into performing the sim-swap and this can be used to automate the attack end-to-end at scale.   AI can also be used to study a target victim and spot patterns of behaviours through open-source intelligence, allowing an attacker to strike at the perfect time to have the highest chance of success.

## 3. The Human Element: A Persistent Vulnerability
No matter how strong technical barriers are, humans often remain the most exploitable link. Social pressure, flawed verification protocols, and misplaced trust can bypass even the most advanced defenses.

---

## Scattered Spider

**Scattered Spider** also known as 0ktapus, Starfraud, UNC3944, Scatter Swine, Octo Tempest, and Muddled Libra are a threat actor who have been recently hitting some of the largest companies around and primarily using social engineering techniques against their IT service providers to cause $ millions in damages.

You can read more about the group with intelligence data from, [Crowdstrike](https://www.crowdstrike.com/en-us/blog/crowdstrike-services-observes-scattered-spider-escalate-attacks/) and [Google / Mandiant](https://cloud.google.com/blog/topics/threat-intelligence/unc3944-proactive-hardening-recommendations)


Let's look at a couple of their recent attacks.


## Case Study: **Marks & Spencer** Attack

**Overview:**

- In **April 2025**, marks & Spencer (M&S) announced a cyber incident after disruptions to contactless payments and click-and-collect services over the Easter weekend.
- The attackers, identified as the hacking group **Scattered Spider**, breached M&S’s systems by exploiting a **third-party IT vendor’s service desk**, believed to be operated by **Tata Consultancy Services (TCS)**.
- Through social engineering, attackers posed as internal personnel and persuaded service desk staff to reset credentials, giving them access to domain systems.
- They extracted the `NTDS.dit` Active Directory file, cracked password hashes, and executed the **DragonForce ransomware** across VMware ESXi systems, crippling e-commerce, payment, and logistics systems.

**Impact:**

- Daily online sales halted, leading to estimated losses of **£3.8 million per day**.
- Market capitalization fell by **£500–750 million**, and operating profit losses were estimated at **£300 million**.
- Services remained disrupted for weeks; full online ordering resumed around **June 10**, and click-and-collect by **mid-June**.
- Even with strong cybersecurity investments, human error and supply chain access proved devastating.

**Key Lessons:**

| Lesson | Insight |
|--------|---------|
| **Third-Party Risk** | Vendor access must be strictly controlled and segmented. |
| **Service Desk Security** | Reset policies must include strong identity checks. |
| **Active Directory Defense** | File-level protection, auditing, and network segmentation are essential. |
| **Vendor Oversight** | Cybersecurity must extend beyond internal systems to include all partners. |

---

## Case Study: **Clorox vs. Cognizant**

**Situation:**

- In **August 2023**, Clorox experienced a ransomware attack orchestrated by Scattered Spider.
- In **July–August 2025**, Clorox filed a **$380 million lawsuit** against IT provider Cognizant, alleging negligence and protocol violations by its service desk.

**What Went Wrong:**

- The attackers simply called the Cognizant service desk, impersonated employees, and requested password resets. **Credentials were allegedly handed over without any identity verification !**
- Calls also led to resets of Okta, VPN access, and even SMS MFA numbers;  all granted with no adherence to Clorox's defined verification procedures.
- Clorox claims this breach directly caused operational paralysis, distribution stoppages, **$49 million in remediation costs**, and hundreds of millions in lost revenue.
- The lawsuit cites recorded transcripts demonstrating the extraordinary simplicity of the attack.

**Key Takeaways:**

- Even rudimentary social engineering can have massive impacts when internal controls fail.
- Service desks must follow strict identity validation protocols—including manager contact, employee identifiers, and audit trails.
- Failure in basic verification can expose the entire network, leading to legal, operational, and reputational fallout.

---

## Why Humans Remain the Weakest Link

- **Trust & Assumption**: Employees often assume inbound requests are legitimate, especially under pressure.
- **Targeted Tactics**: Threat actors are doing their research, successful attacks are because context and timing matter.
- **Procedural Gaps**: Many help desks lack robust, enforced authentication steps.
- **Supply Chain Exposure**: Vendors with network access can become points of compromise.

---

## Recommendations: Building a Human-Aware Defense

1. **Mandatory Identity Verification**
   - Enforce multi-step checks: ask for unique identifiers, manager validation, and notify via separate channels.
2. **Harden Service Desks**
   - Limit reset capabilities; use phish-resistant MFA like passkeys or hardware yubikeys and implement full audit logging.
3. **Vendor Controls**
   - Grant least privilege, segment vendor access, and regularly review third-party rights.
4. **Protect Crown-Jewel Assets**
   - Use certificates and tokens along with phish-resistant MFA instead of usernames and passwords, encrypt backups, limit admin access, and monitor lateral movement.
5. **Training & Simulations**
   - Regularly test staff and partners with phishing/vishing drills and reinforce reporting culture.
6. **Resilience Planning**
   - Develop incident response plans; covering continuity, communications, backups, and legal readiness.

---

## Final Thoughts

Technological defenses matter, but they're useless if trust is exploited. The M&S and Clorox incidents reveal how simple human errors at privileged entry points can devastate large organizations. The solution isn’t to eliminate humans but to empower them with processes, training, and systems that make social engineering far less likely to succeed. A robust cybersecurity posture depends on both tech and the people behind it.