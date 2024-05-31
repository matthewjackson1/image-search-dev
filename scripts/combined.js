const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require("openai");

const openai = new OpenAI({
    apiKey: 'CENSORED',
    organization: "CENSORED",
    project: "proj_SI7DYq3LS1prVmiikwbO4kpQ",
});

// Set the download directory to the desktop
const downloadDir = path.join(require('os').homedir(), 'Desktop', 'images_2');

const urls = [
    { url: "https://www.lovecrafts.com/en-gb/l/knitting/knitting-patterns", maxImages: 100 },
    { url: "https://www.lovecrafts.com/en-gb/l/crochet/crochet-patterns", maxImages: 100 }
];
const itemsPerPage = 100;

// Function to encode the image
const encodeImage = (imagePath) => {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
};

async function analyseImage(imagePath) {
    const base64Image = encodeImage(imagePath);
    const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    { 
                        type: "text",
                        text: "I am creating an image search engine for my website to help users find similar products based on their uploaded photos. We primarily sell knitting and crochet patterns, so our product images mostly feature either the garment/project itself or a model wearing it. I need an array of descriptive labels for these images - this can also include vocabulary that users might use when searching. The labels should detail the knitted/crocheted garment or project, including aspects like style, theme, construction, and type of garment. This will make search results more relevant. For the example knitting pattern photo I'm uploading, please provide a detailed JavaScript array of strings with these labels. Respond only with the array in the format: ['label1', 'label2', 'label3']." },
                    {
                        type: "image_url",
                        image_url: {
                            "url": `data:image/jpeg;base64,${base64Image}`,
                            "detail": "low"
                        },
                    },
                ],
            },
        ],
    });
    return response.choices[0].message.content;
}

async function scrapeImages(url, itemsPerPage, maxImages) {
    let images = [];
    let page = 1;

    while (images.length < maxImages) {
        const pageUrl = `${url}?itemsPerPage=${itemsPerPage}&page=${page}`;
        try {
            const response = await axios.get(pageUrl);
            const $ = cheerio.load(response.data);

            $('.sf-product-card__link.products__product-card__image-link').each((_, link) => {
                const href = $(link).attr('href');
                const img = $(link).find('img.sf-product-card__image.products__product-card__image');
                const src = img.attr('src');
                const alt = img.attr('alt');
                if (src && href) {
                    images.push({ src, alt, href });
                    if (images.length >= maxImages) return false;
                }
            });
        } catch (error) {
            console.error(`Failed to retrieve page ${page} from ${url}: ${error.message}`);
            break;
        }
        page++;
    }

    return images.slice(0, maxImages);
}

async function downloadImage(url, filepath, metadata) {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data, 'binary');
    
    await sharp(imageBuffer)
        .withMetadata({ 
            exif: { 
                IFD0: { 
                    UserComment: metadata.href 
                } 
            }
        })
        .toFile(filepath);
}

async function downloadImages(images) {
    await fs.ensureDir(downloadDir);
    const downloadPromises = images.map(async (image, index) => {
        const filename = `image_${index + 1}.jpeg`;
        const filepath = path.join(downloadDir, filename);
        try {
            await downloadImage(image.src, filepath, { href: image.href });
            console.log(`Downloaded ${filename} with metadata`);
            const analysis = await analyseImage(filepath);
            fs.appendFileSync('image_analysis.csv', `${filename},${analysis},${image.href}\n`);
        } catch (error) {
            console.error(`Failed to download or analyse ${filename}: ${error.message}`);
        }
    });
    await Promise.all(downloadPromises);
}

(async () => {
    let allImages = [];
    for (const { url, maxImages } of urls) {
        const images = await scrapeImages(url, itemsPerPage, maxImages);
        console.log(`Scraped ${images.length} images from ${url}.`);
        allImages = allImages.concat(images);
    }
    console.log(`Total images scraped: ${allImages.length}`);
    await downloadImages(allImages);
    console.log('All images downloaded.');
})();