from PIL import Image, ImageDraw

# Create a new image with white background
img = Image.new('RGB', (800, 400), color=(255, 255, 255))
draw = ImageDraw.Draw(img)

# Draw sample bars for inventory categories
categories = ['Grains', 'Vegetables', 'Fruits', 'Pulses', 'Packed Food']
colors = [(15, 111, 75), (13, 95, 134), (191, 59, 45), (74, 87, 93), (24, 32, 34)]
x_positions = [50, 200, 350, 500, 650]
heights = [300, 250, 200, 150, 100]  # Sample heights

for i, (cat, color, x, h) in enumerate(zip(categories, colors, x_positions, heights)):
    draw.rectangle([x, 400 - h, x + 80, 400], fill=color)
    draw.text((x, 400 - h - 20), cat, fill=(0, 0, 0))

# Add title
draw.text((300, 20), "Sample Inventory Overview", fill=(0, 0, 0))

# Save the image
img.save('frontend/inventory_chart.png')
print("Graphic generated and saved as inventory_chart.png")