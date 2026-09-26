
import os
import json
import logging
from typing import List, Dict, Optional
from firecrawl import FirecrawlApp
from urllib.parse import urlparse
from datetime import datetime
from mcp.server.fastmcp import FastMCP

from dotenv import load_dotenv

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

SCRAPE_DIR = "scraped_content"

mcp = FastMCP("llm_inference")

@mcp.tool()
def scrape_websites(
    websites: Dict[str, str],
    formats: List[str] = ['markdown', 'html'],
    api_key: Optional[str] = None
) -> List[str]:
    """
    Scrape multiple websites using Firecrawl and store their content.

    NOTE: Scraping is expensive. Before calling this tool, check for already-saved data
    with extract_scraped_info (per provider). Only scrape providers that have no saved
    content, or when the user explicitly asks for a fresh scrape/refresh.

    Args:
        websites: Dictionary of provider_name -> URL mappings
        formats: List of formats to scrape ['markdown', 'html'] (default: both)
        api_key: Firecrawl API key (if None, expects environment variable)

    Returns:
        List of provider names for successfully scraped websites
    """
    
    if api_key is None:
        api_key = os.getenv('FIRECRAWL_API_KEY')
        if not api_key:
            raise ValueError("API key must be provided or set as FIRECRAWL_API_KEY environment variable")
    
    app = FirecrawlApp(api_key=api_key)
    
    path = os.path.join(SCRAPE_DIR)
    os.makedirs(path, exist_ok=True)
    
    # save the scraped content to files and then create scraped_metadata.json as a summary file
    # check if the provider has already been scraped and decide if you want to overwrite
    # {
    #     "cloudrift_ai": {
    #         "provider_name": "cloudrift_ai",
    #         "url": "https://www.cloudrift.ai/inference",
    #         "domain": "www.cloudrift.ai",
    #         "scraped_at": "2025-10-23T00:44:59.902569",
    #         "formats": [
    #             "markdown",
    #             "html"
    #         ],
    #         "success": "true",
    #         "content_files": {
    #             "markdown": "cloudrift_ai_markdown.txt",
    #             "html": "cloudrift_ai_html.txt"
    #         },
    #         "title": "AI Inference",
    #         "description": "Scraped content goes here"
    #     }
    # }
    metadata_file = os.path.join(path, "scraped_metadata.json")

    # Load existing metadata so repeat runs update rather than clobber history.
    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            scraped_metadata = json.load(f)
        if not isinstance(scraped_metadata, dict):
            scraped_metadata = {}
    except (FileNotFoundError, json.JSONDecodeError):
        scraped_metadata = {}

    successful_scrapes: List[str] = []

    for provider_name, url in websites.items():
        try:
            logger.info(f"Scraping {provider_name}: {url}")
            scrape_result = app.scrape(url, formats=formats).model_dump()

            # firecrawl-py v4 Documents carry no 'success' field (failures raise
            # instead), so fall back to checking that content actually came back.
            success = scrape_result.get(
                "success",
                any(scrape_result.get(format_type) for format_type in formats),
            )

            metadata = {
                "provider_name": provider_name,
                "url": url,
                "domain": urlparse(url).netloc,
                "scraped_at": datetime.now().isoformat(),
                "formats": formats,
                "success": success,
            }

            if success:
                content_files = {}
                for format_type in formats:
                    content = scrape_result.get(format_type)
                    if content is None:
                        continue
                    filename = f"{provider_name}_{format_type}.txt"
                    with open(os.path.join(SCRAPE_DIR, filename), "w", encoding="utf-8") as f:
                        f.write(content)
                    content_files[format_type] = filename

                page_metadata = scrape_result.get("metadata") or {}
                metadata["content_files"] = content_files
                metadata["title"] = page_metadata.get("title", "")
                metadata["description"] = page_metadata.get("description", "")

                successful_scrapes.append(provider_name)
                logger.info(f"Successfully scraped {provider_name} ({list(content_files)})")
            else:
                logger.error(
                    f"Failed to scrape {provider_name}: "
                    f"{scrape_result.get('error', 'unknown error')}"
                )

            scraped_metadata[provider_name] = metadata

        except Exception as e:
            logger.error(f"Error scraping {provider_name} ({url}): {e}")
            scraped_metadata[provider_name] = {
                "provider_name": provider_name,
                "url": url,
                "domain": urlparse(url).netloc,
                "scraped_at": datetime.now().isoformat(),
                "formats": formats,
                "success": False,
                "error": str(e),
            }

    with open(metadata_file, "w", encoding="utf-8") as f:
        json.dump(scraped_metadata, f, indent=2)

    logger.info(
        f"Successfully scraped {len(successful_scrapes)} out of {len(websites)} websites"
    )
    return successful_scrapes

@mcp.tool()
def extract_scraped_info(identifier: str) -> str:
    """
    Extract information about a previously scraped website from local storage.

    This reads saved data only — no network calls, no scraping cost. Call this FIRST
    when answering questions about a provider; only fall back to scrape_websites if
    this returns a "no saved information" message.

    Args:
        identifier: The provider name, full URL, or domain to look for

    Returns:
        Formatted JSON string with the scraped information
    """
    
    logger.info(f"Extracting information for identifier: {identifier}")
    logger.info(f"Files in {SCRAPE_DIR}: {os.listdir(SCRAPE_DIR)}")

    metadata_file = os.path.join(SCRAPE_DIR, "scraped_metadata.json")
    logger.info(f"Checking metadata file: {metadata_file}")

    try:
        with open(metadata_file, "r", encoding="utf-8") as f:
            scraped_metadata = json.load(f)

        for provider_name, metadata in scraped_metadata.items():
            if identifier in (
                provider_name,
                metadata.get("url", ""),
                metadata.get("domain", ""),
            ):
                result = metadata.copy()

                if metadata.get("content_files"):
                    result["content"] = {}
                    for format_type, filename in metadata["content_files"].items():
                        try:
                            file_path = os.path.join(SCRAPE_DIR, filename)
                            with open(file_path, "r", encoding="utf-8") as cf:
                                result["content"][format_type] = cf.read()
                        except FileNotFoundError:
                            logger.error(f"Content file not found: {filename}")

                return json.dumps(result, indent=2)

    except (FileNotFoundError, json.JSONDecodeError) as e:
        logger.error(f"Could not load metadata: {e}")

    return f"There's no saved information related to identifier '{identifier}'."

if __name__ == "__main__":
    mcp.run(transport="stdio")