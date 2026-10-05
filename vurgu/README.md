# Vurgu

Claude Code modu. Uzun bir çalışmada asıl okunacak şeyi, yani yazıları öne
çıkarır.

- **Araçları katlar.** Arka arkaya çalışan araçlar tek soluk satır olur:
  `▸ 4 işlem · Bash ×3, Edit`. Satıra tıklayınca açılır; açıkken her aracın
  üstündeki satıra tıklamak yeniden katlar. Çalışmakta olan ve hata veren araç
  gizlenmez. Araya yazı girince grup orada bölünür, yazı hiçbir zaman gizlenmez.
- **Mesajları renklendirir.** Üç tür ayrı renk alır: senin mesajların, Claude'un
  iş arasında yazdıkları (ardından araç çalıştırdığı yazılar) ve kapanış mesajı.
- **Mesajlar arasında atlar.** Yazı alanının üstündeki `↑ Ben`, `↓ Ben`,
  `↑ Claude`, `↓ Claude` düğmeleri sohbeti o yöndeki en yakın mesaja kaydırır.
  Satıra bir kez tıkladıktan sonra `1` `2` `3` `4` tuşları da aynı işi görür.

## Renk seçimi

`/vurgu` sağda renk panelini açar, `/vurgu kapat` kapatır. Her tür için hazır
tonlardan biri, `renksiz` ya da `#rrggbb` biçiminde kendi rengin seçilir. Seçim
hemen uygulanır ve sonraki oturumlarda hatırlanır.

## Kurulum

Gerekenler: Claude Code 2.1.287+, bir terminal (mod yalnızca terminalde çizer),
`/usr/bin/python3`.

Depoyu indirip klasörü `~/.claude/settings.json` içindeki `env` bölümüne ekle
([ana README](../README.md#kurulum)):

```json
"CLAUDE_CODE_PLUGIN_DIRS": "~/claude-code-mods/vurgu"
```

## Bilinen sınırlar

- Terminal, yukarıda kalan satırları yeniden çizmez: mod yüklenmeden önce
  çizilmiş mesajlar eski haliyle kalır, oturum yeniden açılınca düzelir.
- Renkli mesajları mod kendisi çizer; motorun kendi satırı renkli bir kutunun
  içine konamıyor.
- Açılmış bir aracın çıktısına tıklamak grubu katlamaz; yalnızca araçların
  üstündeki satırlar tıklanır.
- Yeni bir yazı önce kapanış renginde çıkar, ardından araç çalışırsa iş arası
  rengine döner.

## Geliştirme

```sh
claude plugin validate .
claude plugin test .
```

| Dosya | İçerik |
| --- | --- |
| `hooks/register.tsx` | Modun kendisi: katlama, renkler, panel, atlama |
| `bin/sira.py` | Oturum kaydından mesaj ve araç sırasını çıkarır |
| `types/index.d.ts` | Modun tuttuğu değerlerin tipleri |
