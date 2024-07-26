const fetch = require('node-fetch');
require('dotenv').config();

// Your commercetools project key, client ID, and client secret

// const projectKey = 'lc-preprod';
const projectKey = process.env.CT_PROJECT_KEY;
const clientId = process.env.CT_CLIENT_ID;
const clientSecret = process.env.CT_CLIENT_SECRET;
const authHost = 'https://auth.europe-west1.gcp.commercetools.com';
const apiHost = 'https://api.europe-west1.gcp.commercetools.com';
const authEndpoint = `${authHost}/oauth/token?grant_type=client_credentials`;

async function getCTAccessToken() {
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(authEndpoint, {
    method: 'post',
    headers: {
        Authorization: `Basic ${auth}`
    }
    });
    const json = await res.json();
    return json;
}

const getBaseImage = (assets) => {
    const baseImageAsset = assets.find(asset => asset.tags?.includes('base_image'));
    return baseImageAsset.sources?.[0]?.uri;
}

const getProductInfo = async (keys) => {
    const { access_token: token } = await getCTAccessToken();
    // The headers for the API request
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };

    // The commercetools API URL
    const apiUrl = `${apiHost}/${projectKey}/product-projections`;

    // Create the where predicate
    const wherePredicate = `key in (${keys.map(key=>`"${key}"`).join(',')})`;

    // Fetch product information
    const productResponse = await fetch(`${apiUrl}?where=(${wherePredicate})`, { headers });
    const data = await productResponse.json();
    if (data.statusCode) {
        console.error('Error fetching product information', data);
        return;
    }
    const productInfo = data.results.reduce((acc, product) => {
        acc[product.key] = {
            url: `https://www.lovecrafts.com/en-gb/p/${product.slug['en-GB']}`,
            name: product.name['en-GB'],
            image: getBaseImage(product.masterVariant.assets)
        }
        return acc;
    }, {});
    return productInfo;
}
 module.exports = {
    getProductInfo
 }
// getProductInfo(productKeys);