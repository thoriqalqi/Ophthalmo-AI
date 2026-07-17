# Folder Jurnal Referensi Medis (Ground Truth)

Letakkan file jurnal medis, panduan triase, atau standar klinis Anda di folder ini agar dibaca secara otomatis oleh LLM Gemini sebagai referensi verifikasi silang (close validation).

## Format File yang Didukung:
1. **`.txt` / `.md` (Sangat Direkomendasikan):** Berisi salinan teks artikel/jurnal medis secara utuh.
2. **`.json`:** Berisi pasangan key-value atau pedoman diagnosis terstruktur.

*Catatan: Sistem backend akan secara otomatis membaca seluruh isi file teks di folder ini saat Express server dinyalakan, kemudian menyuntikkannya ke dalam System Prompt Gemini sebagai basis bukti medis.*
