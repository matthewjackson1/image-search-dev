const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');

// Set the download directory to the desktop
const downloadDir = path.join(require('os').homedir(), 'Desktop', 'images');

const urls = [
    { url: "https://www.lovecrafts.com/en-gb/l/knitting/knitting-patterns", maxImages: 500 },
    { url: "https://www.lovecrafts.com/en-gb/l/crochet/crochet-patterns", maxImages: 500 }
];
const itemsPerPage = 100;

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
    const downloadPromises = images.map((image, index) => {
        const filename = `image_${index + 1}.jpeg`;
        const filepath = path.join(downloadDir, filename);
        return downloadImage(image.src, filepath, { href: image.href }).then(() => {
            console.log(`Downloaded ${filename} with metadata`);
        }).catch(error => {
            console.error(`Failed to download ${filename}: ${error.message}`);
        });
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