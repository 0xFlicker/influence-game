// Installed as src/bin/house-discord-relay.rs in the pinned Overclaw build tree.
use anyhow::{Context, Result};
use overclaw::proxy::Proxy;

#[tokio::main]
async fn main() -> Result<()> {
    let provider = std::env::var("OPENAI_IDENTITY_PROVIDER_ID").context("Missing provider ID")?;
    let account = std::env::var("OPENAI_SERVICE_ACCOUNT_ID").context("Missing service account ID")?;
    let token = std::env::var("HOUSE_INFERENCE_LOCAL_TOKEN").context("Missing local relay token")?;
    let aws = aws_config::load_defaults(aws_config::BehaviorVersion::latest()).await;
    let _proxy = Proxy::start(&aws, provider, account, &token).await?;
    eprintln!("Federated Responses relay ready");
    tokio::signal::ctrl_c().await?;
    Ok(())
}
