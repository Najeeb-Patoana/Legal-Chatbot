require("dotenv").config({ path: require("path").resolve(__dirname, ".env") });
const axios = require("axios");

async function run() {
    try {
        const { data } = await axios.get(`https://api.govinfo.gov/collections?api_key=${process.env.GOVINFO_API_KEY}`);
        console.log(data.collections.map(c => c.collectionCode).join(", "));
    } catch (e) {
        console.error(e.message);
    }
}
run();
