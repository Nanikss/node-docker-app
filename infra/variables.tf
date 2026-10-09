variable "region" {
  description = "AWS region to deploy into."
  type        = string
  default     = "ap-south-1"
}

variable "instance_type" {
  description = "EC2 instance type."
  type        = string
  default     = "t3.micro"
}

variable "ssh_cidr" {
  description = "CIDR allowed to reach SSH (port 22), e.g. your IP as 203.0.113.10/32."
  type        = string

  validation {
    condition     = can(cidrhost(var.ssh_cidr, 0)) && !strcontains(var.ssh_cidr, ":")
    error_message = "ssh_cidr must be a valid IPv4 CIDR block, e.g. 203.0.113.10/32."
  }
}

variable "key_name" {
  description = "Name of an existing EC2 key pair for SSH (used by the deploy workflow). Null disables SSH key login."
  type        = string
  default     = null
}

variable "image" {
  description = "Container image the instance runs on first boot. Later releases go through scripts/deploy.sh."
  type        = string
  default     = "ghcr.io/nanikss/node-docker-app:latest"
}
