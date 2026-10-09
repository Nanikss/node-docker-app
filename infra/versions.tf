terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

# Credentials come from the standard AWS chain (AWS_PROFILE, env vars or SSO);
# nothing is hard-coded here. State is local; see README for the remote-state note.
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "node-docker-app"
      ManagedBy = "terraform"
    }
  }
}
