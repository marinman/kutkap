"""Render the Kutkap app icon (1024px PNG). Usage: python3 make-icon.py out.png"""
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SIZE = 1024
MARGIN = 100  # macOS icon grid: artwork sits inside ~824px
RADIUS = 185


def vertical_gradient(size, top, bottom):
    img = Image.new("RGB", (size, size))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        color = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        draw.line([(0, y), (size, y)], fill=color)
    return img


def main(out_path):
    icon = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    body = MARGIN, MARGIN, SIZE - MARGIN, SIZE - MARGIN

    shadow = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).rounded_rectangle(
        (body[0], body[1] + 18, body[2], body[3] + 18), RADIUS, fill=(0, 0, 0, 110)
    )
    icon.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(22)))

    mask = Image.new("L", (SIZE, SIZE), 0)
    ImageDraw.Draw(mask).rounded_rectangle(body, RADIUS, fill=255)
    bg = vertical_gradient(SIZE, (38, 38, 52), (12, 12, 18)).convert("RGBA")
    icon.paste(bg, (0, 0), mask)

    draw = ImageDraw.Draw(icon)
    # Timeline strip with a playhead, the "editor" cue.
    strip_y = 700
    clips = [(200, 400, (255, 225, 77)), (418, 600, (94, 200, 160)), (618, 824, (90, 140, 255))]
    for x0, x1, color in clips:
        draw.rounded_rectangle((x0, strip_y, x1, strip_y + 70), 18, fill=color)
    draw.rounded_rectangle((506, strip_y - 30, 518, strip_y + 100), 6, fill=(255, 255, 255))

    font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Black.ttf", 430)
    text = "K"
    box = draw.textbbox((0, 0), text, font=font)
    x = (SIZE - (box[2] - box[0])) / 2 - box[0]
    y = 400 - (box[3] - box[1]) / 2 - box[1]
    draw.text((x, y), text, font=font, fill=(255, 255, 255))
    # Diagonal "cut" through the letter.
    draw.line([(300, 560), (740, 220)], fill=(255, 225, 77), width=34)

    icon.save(out_path)


if __name__ == "__main__":
    main(sys.argv[1])
