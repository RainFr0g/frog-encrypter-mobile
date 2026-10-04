# Frog Encrypter

**Encryption of text fragments, notes, and files both inside and outside the Obsidian vault.**

Frog Encrypter lets you encrypt selected text, entire notes, and any files directly inside Obsidian. Files are encrypted using **AES-256-GCM** and **PBKDF2 (SHA-512)** algorithms.

> ⚠️ **Desktop only.** Some features use desktop-only APIs and do not work on mobile devices. For Android/iOS, use **[Frog Encrypter Mobile](#)** (Coming soon) — files created by either plugin are compatible with each other.

---

## ❤️ Support

If you find Frog Encrypter useful, please support development:

- ⭐ Star the repository
- ☕ [Buy me a coffee](https://buymeacoffee.com/rainfr0g)

Author: **[RainFr0g](https://github.com/RainFr0g)**

---

## ✨ Features

- **Text encryption** — only the selected fragment inside a note is encrypted.
- **Entire note encryption** — the note becomes a `.mdenc` file but remains editable directly in Obsidian.
- **File encryption** — any file supported by Obsidian is encrypted into `.fenc`.
- **Archive packing** — folders and files (both inside and outside the vault) are packed into a single `.fpack`.
- **Compression** — optional DEFLATE compression before encryption, configurable by file extension.
- **Password manager** — stores passwords in memory for a set time and automatically tries them on every decryption.

---

## 📂 Supported formats

Frog Encrypter can encrypt and decrypt any file type supported by Obsidian, including formats added by third-party plugins. Obsidian out of the box supports **24 file types**.

| Category           | Extensions                                                 | Behavior when encrypted |
| ------------------ | ---------------------------------------------------------- | ----------------------- |
| Notes              | `.md`                                                      | ✅ View and edit        |
| Images             | `.png` `.jpg` `.jpeg` `.bmp` `.svg` `.webp` `.avif` `.gif` | ✅ View only            |
| Audio              | `.mp3` `.wav` `.m4a` `.flac` `.oga` `.ogg` `.opus` `.3gp`  | ✅ Listen only          |
| Video              | `.mp4` `.webm` `.mov` `.mkv` `.ogv`                        | ✅ View only            |
| Documents          | `.pdf`                                                     | ❌ Requires decryption  |
| Visual notes       | `.canvas`                                                  | ❌ Requires decryption  |

In total, **22 out of 24** formats can be previewed directly in encrypted form. Only **PDF** and **Canvas** require full decryption.

---

## 🖱 Usage

### In the editor (right-click inside a note)

- **Encrypt selection** — encrypt the selected text
- **Insert encrypted text** — open a modal window and enter text with a password

### In the file explorer

- Right-click a **note** → **Encrypt note**
- Right-click a **file** → **Encrypt file**
- Right-click an **encrypted note** → **Decrypt note**
- Right-click an **encrypted file** → **Decrypt file**
- Right-click a **folder or empty space** → **New encrypted note**

### Ribbon buttons and commands

- **New encrypted note** — create a new empty encrypted note in the default notes folder
- **Lock all encrypted notes and files** — close all open encrypted tabs
- **Clear password cache** — forcibly clear the password cache

---

## ⚙️ Settings

- **Confirm password** — when encrypting, asks for password confirmation to avoid typos
- **Remember password** — enables storing entered passwords in memory
- **Autofill recent password** — automatically fills in the last successfully used password
- **Password lifetime** — the time during which a password remains in memory after the last manual entry (TTL)
- **Archive encryption** — packing, encrypting, and decrypting `.fpack` archives:
  - Encrypt the entire vault
  - Encrypt external files or folders (switch modes via the gear icon)
  - Decrypt existing `.fpack` files
- **Compression mode**:
  - `Always` — compress everything
  - `Never` — do not compress
  - `Compress by extension` — configure rules by extension (e.g., compress `.txt`, skip `.jpg`)

---

## 🔐 Security

- **Algorithm:** AES-256-GCM
- **Key derivation:** PBKDF2 (SHA-512) with 200,000 iterations
- **Compression:** DEFLATE (via [pako](https://github.com/nodeca/pako))
- **Storage:** encrypted data is stored in base64 (strings and notes) or in binary format (files and archives)
- **Chunking:** encryption of files and `.fpack` archives uses asynchronous streaming chunk processing — minimal RAM usage even for large files. Chunking is not used for strings and notes.

## 🚀 Performance notes

**PBKDF2 as protection against brute force.** Key derivation uses **PBKDF2 with 200,000 SHA-512 iterations**. This is deliberate — it makes password brute-forcing computationally expensive, extending the search time from hours to hundreds of years. The trade-off is that each new `(password, salt)` pair requires a one-time key derivation, which takes a noticeable amount of time.

When **Remember password** is enabled, saved passwords are automatically tried against each encrypted file. With only a few passwords in memory, this is imperceptible. With **more than 10 passwords**, trying them sequentially can push decryption time **past one second**, and it keeps growing with each additional password. Keep a reasonable number of passwords in memory to avoid slowdowns when opening your records.

If speed matters more than convenience, disable **Remember password** and enter the password manually — then each decryption involves exactly one PBKDF2 derivation, with no trial-and-error.

**The delay only applies to files opened for the first time.** Once a file has been successfully decrypted with a given password, its derived key is cached in memory. Subsequent opens of the same file reuse the cached key and skip PBKDF2 entirely, making them essentially instant.

**Compression — a trade-off between speed and size.** Running DEFLATE before encryption noticeably slows down encryption and decryption of **large** files, since compression costs CPU time. However:

- On **text documents** (`.md`, `.txt`, `.json`, `.xml`, `.html`, source code), compression typically reduces size by **3–10×**, while the speed cost is minor — text compresses quickly, and the I/O savings often offset the CPU work.
- On **media files** (`.jpg`, `.png`, `.mp4`, `.mp3`), compression brings almost no size reduction but still spends time. That's why they are **excluded** from compression by default.
- On **already-compressed archives** (`.zip`, `.7z`, `.gz`), DEFLATE is useless — they are already compressed.
- On **large binary files** (`.exe`, `.dll`, `.iso`), compression can slow the operation down several times without a meaningful size gain.

By default, the **Compress by extension** mode is used with a sensible set of rules. If maximum speed matters, switch the mode to `Never`.

---

## ⚠️ Warning

> **Use at your own risk**
>
> - Passwords are **never stored** in plaintext. If you forget your password, **data cannot be recovered**.
> - The encryption methods used **have not undergone an independent audit**.
> - Bugs may appear at any time. **You are fully responsible for data safety and keeping regular backups.**