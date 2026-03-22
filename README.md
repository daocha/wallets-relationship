# ⛓️ Blockchain Wallet Relationship Investigator  
### Solana & Ethereum

---

## 🔎 Overview

An **on-chain, forensic-grade wallet relationship investigator**.

This tool determines whether **two blockchain wallets are meaningfully connected** through real asset flow — not coincidental activity like airdrops, spam tokens, or exchange distributions.

---

## ✨ Key Features

- 🔍 **Bidirectional Relationship Search**  
  Traces connections from both wallets simultaneously to efficiently discover the shortest path.

- ⚡ **In-Memory Intelligence Cache**  
  Every scanned wallet is remembered to minimize redundant API calls and avoid rate limits.

- 🛡️ **Spam & Noise Filtering**  
  Detects and ignores common sender patterns (airdrops, faucets, spam) while preserving them as forensic notes.

- 🧭 **Cross-Chain Support**  
  Works seamlessly on **Solana** and **Ethereum**, automatically detecting wallet type.

- 📎 **Evidence-First Results**  
  Every discovered relationship includes direct transaction links for verification.

- 💅 **Readable, Investigator-Friendly UI**  
  Clean dark-mode dashboard with shortened address formatting (`0x1234…abcd`).

---

## Preview

![Screenshot 2026-02-27 at 7 26 02 PM](https://github.com/user-attachments/assets/0820a787-6051-4fc3-81d7-8ac77e387de1)

## 3️⃣ Environment Setup

Create a `.env` file in the project root directory:

```env
HELIUS_API_KEY=your_helius_key_here
ETHERSCAN_API_KEY=your_etherscan_key_here
PORT=3000
```

---

## 4️⃣ Launch

```bash
npm start
```

Then open your browser:

```text
http://localhost:3000
```

---

## 🛠️ Tech Stack

| Layer | Technology |
|------|------------|
| Backend | Node.js, Express |
| Real-time | Socket.IO |
| Address Validation | multicoin-address-validator |
| Blockchain APIs | Helius (Solana), Etherscan (Ethereum) |
| Labels | Solana.fm |
| Frontend | Vanilla JS, HTML5, CSS3 |

---

## 📖 How It Works

1. **Parallel Expansion**  
   Both wallets are explored outward at the same time.

2. **Relationship Evaluation**  
   Intersections are analyzed for fund flow direction.

3. **Spam & Noise Filtering**  
   Common sender-only overlaps are ignored.

4. **Path Reconstruction**  
   Meaningful connections are rebuilt with verified transaction links.

---

## 🧠 What This Tool Answers

> “Are these two wallets connected by real financial activity, or just blockchain noise?”

---

## ⚠️ Important Notes

- Indicates transactional relationships, not ownership.
- Exchange and bridge wallets may appear as intermediaries.

---

## License

This project is released under the MIT License. Add a `LICENSE` file containing the MIT text when publishing or redistributing it.

