import unittest

from app.services.media_service import song_folder


class SongFolders(unittest.TestCase):
    def test_the_song_name_without_the_lyric_video_ending(self):
        self.assertEqual(song_folder('எனைத் தொட்டிழுத்தாள்! – Lyric video'), 'எனைத் தொட்டிழுத்தாள்!')
        self.assertEqual(song_folder('வா வா சூரியனே – 3D lyric video'), 'வா வா சூரியனே')
        self.assertEqual(song_folder('அனல் வீசும் நிலவு'), 'அனல் வீசும் நிலவு')
        self.assertIsNone(song_folder('  '))


if __name__ == '__main__':
    unittest.main()
