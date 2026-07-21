const axios = require("axios");

async function run() {
    try {
        const { data } = await axios.get(`https://en.wikisource.org/w/api.php?action=query&prop=extracts&explaintext=1&titles=Constitution_of_the_United_States_of_America&format=json`);
        const pages = data.query.pages;
        const pageId = Object.keys(pages)[0];
        console.log(pages[pageId].extract.substring(0, 500));
    } catch (e) {
        console.error(e.message);
    }
}
run();
