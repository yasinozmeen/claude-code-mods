# Claude Code Mods

Yasin'in Claude Code modlarının ortak deposu. Herkese açık (public).

## Yapı

- Her mod kökte kendi klasöründedir (`vitrin/`, `vurgu/`): `.claude-plugin/plugin.json`,
  `hooks/`, `tests/`, varsa `types/`, `bin/`, `docs/` ve kendi `README.md` dosyası.
- Kökteki `README.md` vitrindir: modların listesi. Modun ayrıntısı kendi README'sindedir.
- Yeni mod yazarken `plugin-authoring` skill'i yüklenir.

## README kuralları (her değişiklikte)

Yeni mod eklendiğinde ya da bir modun davranışı değiştiğinde README'ler aynı işin
parçası olarak güncellenir; ayrı bir iş olarak ertelenmez.

- **Kök `README.md`:** her mod için tek paragraf (ne işe yarar), en az bir ekran
  görüntüsü ve modun kendi README'sine bağlantı. Kullanım ayrıntısı, komut listesi,
  dosya tablosu buraya yazılmaz; kök README kısa kalır.
- **Modun `README.md` dosyası:** ne yapar, kullanım, komutlar, kurulum ve gerekenler,
  bilinen sınırlar, geliştirme.
- **Ekran görüntüsü:** modun `docs/` klasöründe durur. Görüntüde kişisel bilgi
  (başka pencere, pano geçmişi, özel sohbet içeriği, özel proje adı) bulunmaz.
  Ekran görüntüsü olmayan mod kök README'de bunu açıkça yazar ve eksik olarak sayılır.
- Bir davranış kaldırıldıysa README'den de kaldırılır.

## Gizlilik (public depo)

- Şifre, anahtar, token, özel sunucu adresi, müşteri verisi, özel proje adı commit edilmez.
- Kodda ve belgede kişiye özel mutlak yol (`/Users/<ad>/…`) yazılmaz; `~` ya da
  modun kendi kökü (`$.plugin.root`) kullanılır.
- Commit'teki e-posta adresi kişisel bilgi sayılmaz (Yasin kararı, 2026-10-05).
- Push'tan önce değişen dosyalar bu gözle taranır.

## Çalışma

- Dil: README ve arayüz metinleri Türkçe. Kod yorumları İngilizce, mevcut dosyaların
  üslubunda.
- Her mod için: `claude plugin validate <klasör>` ve `claude plugin test <klasör>`
  geçmeden commit atılmaz.
- Terminaldeki gerçek görüntü otomatik testte görülmez; görünümü değiştiren iş
  Yasin'in ekranında denenmeden "bitti" denmez.
- Push kullanıcı onayı ister.
