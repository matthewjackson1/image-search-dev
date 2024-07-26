// The default API key is xyz and the default port is 8108
// The config file is at /usr/local/etc/typesense/typesense.ini
// Logs are under /usr/local/var/log/typesense/
// Data dir is under /usr/local/var/lib/typesense/

const Typesense = require('typesense')
const fs = require('fs');
const csv = require('csv-parser');

const { getSingleResult } = require('./combined.js');
const { getProductInfo } = require('./ctClient.js');
const { get } = require('http');

let client = new Typesense.Client({
  'nodes': [{
    'host': 'localhost', // For Typesense Cloud use xxx.a1.typesense.net
    'port': 8108,      // For Typesense Cloud use 443
    'protocol': 'http'   // For Typesense Cloud use https
  }],
  'apiKey': 'xyz',
  'connectionTimeoutSeconds': 2
})

function createSchema () {
    const productsSchema = {
        name: 'products',
        fields: [
            { name: 'sku', type: 'string', facet: false },
            { name: 'imageKeywords', type: 'string[]', facet: false },
            { name: 'imageKeywordsString', type: 'string', facet: false },
        ]
    };

    client.collections().create(productsSchema)
      .then(function (data) {
        //console.log(data)
      });
}

function createJsonlFile () {
    const results = [];
    fs.createReadStream('scripts/imageAnalysisGsheet.csv')
    .pipe(csv())
    .on('data', (data) => {
        data.imageKeywords = data.imageKeywords.split(';').map(keyword => keyword.replace(/"/g, '').trim());
        data.imageKeywordsString = data.imageKeywords.join('; ');
        results.push(data);
    })
    .on('end', () => {
        const writeStream = fs.createWriteStream('products.jsonl');
        results.forEach(result => writeStream.write(JSON.stringify(result) + '\n'));
        writeStream.end();
    });
}

function importData () {
    client.collections('products').documents().import(fs.createReadStream('products.jsonl'))
    .then(function (data) {
        console.log(data)
    });
}

function getSearchParameters (term, queryBy = 'imageKeywordsString') {
    return {
        'q'         : term,
        'query_by'  : queryBy,
    }
  }

// client.collections('products').delete();
// createSchema();
// importData();

async function performSearch (searchTerm) {
    const args = process.argv.slice(2);
    const term = searchTerm || args[0];
    const queryBy = args[1] || 'imageKeywordsString';
    const searchResults = await client.collections('products').documents().search(getSearchParameters(term, queryBy));
    const skus = searchResults.hits.map(hit => hit.document.sku);
    const ctProductInfo = await getProductInfo(skus);
    const results = searchResults.hits.map(hit => {
        const { url, name, image } = ctProductInfo[hit.document.sku];
        return {
            sku: hit.document.sku,
            imageKeywordsString: hit.document.imageKeywordsString,
            url,
            name,
            image,
            matchedTokens: JSON.stringify(hit.highlights?.[0]?.matched_tokens),
        }
    });
    console.log({
        searchTerm: term,
        queryBy,
        hits: searchResults.found,
        results
    });
}

function isValidImageUrl(url) {
    const pattern = /(http(s?):)([/|.|\w|\s|-])*\.(?:jpg|jpeg|gif|png)/;
    return pattern.test(url);
}

async function performImageSearch (imageUrl) {
    // validate image url
    if (!imageUrl) {
        console.error('Error: No image URL provided');
        return;
    }
    if (!isValidImageUrl(imageUrl)) {
        console.error('Error: Invalid image URL', imageUrl);
        return;
    }

    const result = await getSingleResult(imageUrl);
    // if result is not a semi-colon separated string, error
    if (result.split(';').length === 1) {
        console.error('Error: Image analysis failed', result);
        return;
    }
    let term = result.replace(/"/g, '');
    term = term.replace(/;/g, ' ');
    performSearch(term);
}

const args = process.argv.slice(2);
performImageSearch(args[0]);



// createJsonlFile();
// createSchema();
