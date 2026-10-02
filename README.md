# Vitrin

Claude Code modu. Claude'un gönderdiği resim, video, PDF, ses ve web
sayfalarını terminalden çıkmadan sağdaki panelde gösterir.

Panel canlı bir web sayfasıdır: görünmeyen bir tarayıcı sayfayı çizer, her
kare terminale resim olarak akıtılır, tıklama ve kaydırma sayfaya geri
iletilir. Bu sayede kaydırma akıcıdır ve video panelin içinde sesli oynar.

## Kullanım

- Claude bir medya dosyasının yolunu cevabına yazınca panel kendiliğinden açılır.
- Cevaptaki yola tıklamak paneli o dosyada açar.
- `Sohbet` yalnızca cevaplarda geçen medyayı, `Hepsi` araçların ürettiklerini de gösterir.
- `Büyüt` Finder'ın boşluk tuşu önizlemesini, `Aç` varsayılan uygulamayı açar.
- `ctrl` ya da `option` basılıyken `Yolu kopyala` düğmesi `Dizini aç` olur: dosyayı Finder'da gösterir.

| Komut | Ne yapar |
| --- | --- |
| `/vitrin` | Paneli açar |
| `/vitrin <dosya>` | Dosyayı ekler ve gösterir |
| `/vitrin hepsi` / `/vitrin sohbet` | Süzgeci değiştirir |
| `/vitrin temizle` | Listeyi boşaltır |
| `/vitrin kapat` | Paneli ve arkadaki tarayıcıyı kapatır |
| `/vitrin oran 0.47` | Sayfanın en-boy oranını terminal yazı tipine göre düzeltir |

## Kurulum

Gerekenler: macOS, Ghostty ya da kitty (resim çizebilen terminal), Node 22+,
Chrome ya da Brave, ffmpeg.

```sh
swiftc -O bin/onizle.swift -o bin/onizle
```

Ardından `~/.claude/settings.json` içindeki `env` bölümüne:

```json
"CLAUDE_CODE_PLUGIN_DIRS": "/Users/yasin/vitrin"
```

## Geliştirme

```sh
claude plugin validate .
claude plugin test .
```

| Dosya | İçerik |
| --- | --- |
| `hooks/register.tsx` | Modun kendisi: medyayı yakalar, köprüyü çalıştırır, paneli çizer |
| `hooks/paths.ts` | Metinden dosya yolu çıkarma ve yolu bağlantıya çevirme |
| `hooks/hit.tsx` | Paneldeki tıklamaları duyan bölge |
| `bin/bridge.mjs` | Görünmeyen tarayıcıyı yöneten köprü |
| `bin/page.html` | Panelde görünen sayfa |
| `bin/onizle.swift` | `Büyüt` için Finder önizlemesi |

İlk commit, panelin yalnızca terminal öğeleriyle çizilen ilk sürümüdür.
