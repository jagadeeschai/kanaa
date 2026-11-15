"""Image prompts are English, but words to draw in the picture may be Tamil when quoted."""
import unittest

from app.services.lyric_image_service import require_english_visual_prompt as check


class VisualPrompt(unittest.TestCase):
    def test_quoted_tamil_is_text_to_draw(self):
        for prompt in ["create an image that show 'தமிழ்'  in carved in rice field looks stunning with greenery in top angle",
                       'A sign reading “வணக்கம்” at a temple gate', 'The name "கனா" in gold leaf']:
            self.assertEqual(check(prompt), prompt.strip())

    def test_typographic_punctuation_is_english(self):
        check('A poet’s desk — candlelight… soft focus')

    def test_tamil_outside_quotes_or_no_english_is_refused(self):
        for prompt in ['தமிழும் நானும் பாடல்', "'தமிழ்'", 'A field with தமிழ் letters', '   ']:
            with self.assertRaises(ValueError):
                check(prompt)


if __name__ == '__main__':
    unittest.main()
