const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const OpenAI = require("openai");
require('dotenv').config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    organization: process.env.OPENAI_ORG,
    project: process.env.OPENAI_PROJECT,
});

// Set the download directory to the desktop
const downloadDir = path.join(require('os').homedir(), 'Desktop', 'images_new');

const urls = [
    { url: "https://www.lovecrafts.com/en-gb/l/knitting/knitting-patterns", maxImages: 1 },
    { url: "https://www.lovecrafts.com/en-gb/l/crochet/crochet-patterns", maxImages: 1 }
];
const itemsPerPage = 100;

async function scrapeImages(url, itemsPerPage, maxImages) {
    let images = [];
    let page = 1;
    let counter = 0;

    while (images.length < maxImages) {
        const pageUrl = `${url}?itemsPerPage=${itemsPerPage}&page=${page}`;
        try {
            const response = await axios.get(pageUrl);
            const $ = cheerio.load(response.data);

            const productLinks = [];
            $('.sf-product-card__link.products__product-card__image-link').each((_, link) => {
                const href = $(link).attr('href');
                const img = $(link).find('img.sf-product-card__image.products__product-card__image');
                const src = img.attr('src');
                const alt = img.attr('alt');
                if (src && href) {
                    productLinks.push({href, img, src, alt});
                    if (productLinks.length >= maxImages) return false;
                }
            });

            for (const productLink of productLinks) {
                console.log(`Scraping product ${counter++} of page ${page}`)
                const productResponse = await axios.get(productLink.href);
                const $product = cheerio.load(productResponse.data);
                const productSummary = $product('.product-summary, [data-product-key], [data-variant-sku]');
                const sku = productSummary.data('product-key') || productSummary.data('variant-sku');
                if (sku) {
                    images.push({ ...productLink, sku });
                    if (images.length >= maxImages) break;
                }
            }
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


// Function to encode the image
const encodeImage = (imagePath) => {
    const imageBuffer = fs.readFileSync(imagePath);
    return imageBuffer.toString('base64');
};

function getGptRequest(imageUrl) {
    return {
        model: "gpt-4o",
        messages: [
            {
                role: "user",
                content: [
                    { 
                        type: "text",
                        text: "I am creating an image search engine for my website to help users find similar products based on their uploaded photos. We primarily sell knitting and crochet patterns, so our product images mostly feature either the garment/project itself or a model wearing it. I need an array of descriptive labels for each image - this can also include vocabulary that users might use when searching. The labels should detail the knitted/crocheted garment or project, including aspects like style, theme, construction, and type of garment. This will make search results more relevant. For the example knitting pattern photo I'm uploading, please provide a detailed JavaScript array of strings with these labels. Respond only with a string label list in this exact format: \"label1\";\"label2\";\"label3\"" },
                    {
                        type: "image_url",
                        image_url: {
                            "url": imageUrl,
                            "detail": "low"
                        },
                    },
                ],
            },
        ],
    };
}

async function analyseSingleImage(imagePath) {
    const base64Image = encodeImage(imagePath);
    const response = await openai.chat.completions.create(getGptRequest(`data:image/jpeg;base64,${base64Image}`));
    return response.choices[0].message.content;
}

async function createBatch(fileId) {
    const batch = await openai.batches.create({
        input_file_id: fileId,
        endpoint: '/v1/chat/completions',
        completion_window: '24h',
    });
    console.log('Batch created.', batch);
    return batch.id;
}

async function downloadImages(images) {
    await fs.ensureDir(downloadDir);
    const requests = [];
    // fs.appendFileSync('image_analysis.csv', `sku,filename,keywords,image_href\n`);
    const downloadPromises = images.map(async (image, index) => {
        const filename = `${image.sku}.jpeg`;
        const filepath = path.join(downloadDir, filename);
        try {
            await downloadImage(image.src, filepath, { href: image.href });
            console.log(`Downloaded ${filename} with metadata`);
            // requests.push({
            //     custom_id: image.sku,
            //     method: "POST",
            //     url: "/v1/chat/completions",
            //     body: {
            //         model: "gpt-4o",
            //         messages: [
            //             {
            //                 role: "user",
            //                 content: [
            //                     { 
            //                         type: "text",
            //                         text: "I am creating an image search engine for my website to help users find similar products based on their uploaded photos. We primarily sell knitting and crochet patterns, so our product images mostly feature either the garment/project itself or a model wearing it. I need an array of descriptive labels for each image - this can also include vocabulary that users might use when searching. The labels should detail the knitted/crocheted garment or project, including aspects like style, theme, construction, and type of garment. This will make search results more relevant. For the example knitting pattern photo I'm uploading, please provide a detailed JavaScript array of strings with these labels. Respond only with the array in the format: ['label1', 'label2', 'label3']." },
            //                     {
            //                         type: "image_url",
            //                         image_url: {
            //                             "url": `data:image/jpeg;base64,${encodeImage(filepath)}`,
            //                             "detail": "low"
            //                         },
            //                     },
            //                 ],
            //             },
            //         ],
            //     }
            // });
            // const analysis = await analyseSingleImage(filepath);
            // fs.appendFileSync('image_analysis.csv', `${image.sku},${filename},${analysis},${image.href}\n`);
        } catch (error) {
            console.error(`Failed to download or analyse ${filename}: ${error.message}`);
        }
    });
    await Promise.all(downloadPromises);
    return requests;
}

async function getSingleResult(imageUrl) {
    const response = await openai.chat.completions.create(getGptRequest(imageUrl));
    return response.choices[0].message.content;
}

function buildRequests(directory) {
    const requests = [];
    const files = fs.readdirSync(directory);
    files.forEach(file => {
        if (path.extname(file).toLowerCase() !== '.jpeg') return;
        const filepath = path.join(directory, file);
        const sku = path.basename(file, '.jpeg');
        requests.push({
            custom_id: sku,
            method: "POST",
            url: "/v1/chat/completions",
            body: {
                model: "gpt-4o",
                messages: [
                    {
                        role: "user",
                        content: [
                            { 
                                type: "text",
                                text: "I am creating an image search engine for my website to help users find similar products based on their uploaded photos. We primarily sell knitting and crochet patterns, so our product images mostly feature either the garment/project itself or a model wearing it. I need an array of descriptive labels for each image - this can also include vocabulary that users might use when searching. The labels should detail the knitted/crocheted garment or project, including aspects like style, theme, construction, and type of garment. This will make search results more relevant. For the example knitting pattern photo I'm uploading, please provide a detailed JavaScript array of strings with these labels. Respond only with a string label list in this exact format: \"label1\";\"label2\";\"label3\"" },
                            {
                                type: "image_url",
                                image_url: {
                                    "url": `data:image/jpeg;base64,${encodeImage(filepath)}`,
                                    "detail": "low"
                                },
                            },
                        ],
                    },
                ],
            }
        });
    });
    console.log('Requests built.', requests);
    return requests;
}

async function uploadBatchFile(filepath) {
    const response = await openai.files.create({
        purpose: "batch",
        file: fs.createReadStream(filepath),
    });
    console.log('Batch file uploaded.', JSON.stringify(response, null, 2));
    return response.id;
}

// Function to delay execution
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function analyseImagesInFolder() {
    const files = fs.readdirSync(downloadDir);
    const imageFiles = files.filter(file => path.extname(file).toLowerCase() === '.jpeg');

    for (const imageFile of imageFiles) {
        const filepath = path.join(downloadDir, imageFile);
        try {
            const analysis = await analyseSingleImage(filepath);
            fs.appendFileSync('image_analysis.csv', `${path.basename(imageFile, '.jpeg')},${imageFile},${analysis},${filepath}\n`);
            console.log(`Analysed ${imageFile}`);
            await delay(1000); // Delay to handle rate limits
        } catch (error) {
            console.error(`Failed to analyse ${imageFile}: ${error.message}`);
        }
    }
}

function extractArray(text) {
    const array = text.match(/\[.*\]/);
    return array ? array[0] : [];
}

async function processRequestsWithExponentialBackoff(requests) {
    const maxRetries = 5;
    const maxDelay = 10000;
    let delay = 500;
    let retries = 0;
    console.log(`Processing ${requests.length} requests with exponential backoff.`)
    let counter = 1;
    for (const request of requests) {
        let response;
        while (retries < maxRetries) {
            try {
                response = await openai.chat.completions.create(request.body);
                const result = response.choices[0].message.content;
                console.log(result);
                console.log(`Request ${counter++} processed for ${request.custom_id}.`, response, result);
                fs.appendFileSync('image_analysis.csv', `${request.custom_id},${result}\n`);
                break;
            } catch (error) {
                console.error(`Request failed. Retrying with delay of ${delay}ms`, error);
                retries++;
                await new Promise(resolve => setTimeout(resolve, delay));
                delay *= 2;
                delay = Math.min(delay, maxDelay);
            }
        }
        if (retries === maxRetries) {
            console.error('Request failed after maximum retries.', request);
        }
    }
}

async function main () {
    // let allImages = [];
    // for (const { url, maxImages } of urls) {
    //     const images = await scrapeImages(url, itemsPerPage, maxImages);
    //     console.log(`Scraped ${images.length} images from ${url}.`);
    //     allImages = allImages.concat(images);
    // }
    // console.log(`Total images scraped: ${allImages.length}`);
    // await downloadImages(allImages);
    // console.log('All images downloaded.');
    const requests = buildRequests(downloadDir);
    console.log(`Batches built: ${requests.length}`);

    // SINGLE IMAGE PROCESSING FLOW
    await processRequestsWithExponentialBackoff(requests);

    // BATCH PROCESSING FLOW - HIT TOKEN LIMITS 90k per minute. Each req uses about 350
    // const filepath = path.join('requestBatch.jsonl');
    // fs.writeFileSync(filepath, requests.map(JSON.stringify).join('\n'));
    // console.log('Batch requests file created.')
    // const batchFileId = await uploadBatchFile(filepath);
    // console.log(`Batch requests file uploaded. ID: ${batchFileId}`);
    // const batchId = await createBatch(batchFileId);
    // console.log(`Batch created. ID: ${batchId}`);
    // const status = await openai.batches.retrieve(batchId);
    // console.log('Batch status:', status);
    // // await analyseImagesInFolder();
    // console.log('All images analysed.');
}

async function getBatchResults(batchId) {
    const result = await openai.batches.retrieve(batchId);
    console.log(result);
    const { status, output_file_id, errors } = result;
    if (status === 'completed') {
        const response = await openai.files.content(output_file_id);
        const data = await response.text();
        const lines = data.split('\n');
        lines.forEach(line => {
            if (line.trim() !== '') {
                const json = JSON.parse(line);
                const sku = json.custom_id;
                console.log(json);
                const result = json.response.body.choices[0];
                console.log(sku, result.message.content);
            }
        });
    }
    if (status === 'failed') {
        console.error('Batch failed:', errors);
    }
}
// (async () => {
//     await main();
//     // await getBatchResults("batch_GBmVndcUOZDz7mNUCEcPEeZs");

// })();

module.exports = {
    getSingleResult
};