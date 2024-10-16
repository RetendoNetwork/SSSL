/* 
  -- Start Credits --
  Thanks Pretendo for original SSSL.
  Retendo updated the SSSL for add Custom Miiverse Discovery.
  -- End Credits --
*/

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { asn1, pki, md } = require('node-forge');
const prompt = require('prompt');
const colors = require('@colors/colors/safe');
const dotenv = require('dotenv');
const { program, Option } = require('commander');

class KebabCaseOption extends Option {
	attributeName() {
		// "this.name().replace(/^no-/, '')" is from commander source code
		return this.name().replace(/^no-/, '').replace(/-/g, '_');
	}
}

const optionsConfig = {
	nintendo_ca_g3_path: {
		shortOption: 'g3',
		default: './CACERT_NINTENDO_CA_G3.der',
		description: 'Path to Nintendo CA - G3 certificate (may be in DER or PEM format, default to this directory)'
	},
	nintendo_ca_g3_format: {
		shortOption: 'f',
		default: 'der',
		description: 'Nintendo CA - G3 certificate format (must be "der" or "pem")'
	},
	ca_private_key_path: {
		shortOption: 'cap',
		default: undefined,
		description: 'Path to private key for forged CA (will generate if not set)'
	},
	site_private_key_path: {
		shortOption: 'sp',
		default: undefined,
		description: 'Path to private key for site certificate (will generate if not set)'
	},
	csr_path: {
		shortOption: 'csrp',
		default: undefined,
		description: 'Path to CSR (will generate if not set)'
	},
	common_name: {
		shortOption: 'cn',
		default: '*',
		description: 'CN for site certificate (default to "*")'
	},
	output_folder_path: {
		shortOption: 'o',
		default: './',
		description: 'Output folder (default to this directory)'
	}
};

async function main() {
	dotenv.config();

	program.option('-i, --interactive', 'Interactively prompt for all configuration values');
	for (const [option, config] of Object.entries(optionsConfig)) {
		program.addOption(new KebabCaseOption(`-${config.shortOption}, --${option.replace(/_/g, '-')} <value>`, config.description));
	}

	program.parse(process.argv);
	const commandOptions = program.opts();

	if (commandOptions.interactive) {
		showPrompt();

		return;
	}

	const options = {};
	for (const [option, config] of Object.entries(optionsConfig)) {
		options[option] = commandOptions[option] || process.env['SSSL_' + option.toUpperCase()] || config.default;
	}

	if (validateOptions(options)) {
		forgeCertificateChain(options);
	} else {
		throw new Error('Invalid options specified.');
	}
}

async function showPrompt() {
	prompt.message = colors.magenta('SSSL');

	prompt.start();

	const properties = {};
	for (const [option, config] of Object.entries(optionsConfig)) {
		properties[option] = {
			description: colors.blue(config.description),
			default: config.default
		};
	}
	const options = await prompt.get({ properties });

	if (validateOptions(options)) {
		try {
			forgeCertificateChain(options);
		} catch (error) {
			console.log(colors.bgRed(`Error patching CA: ${error}`));

			showPrompt();
		}
	} else {
		showPrompt();
	}
}

function validateOptions(options) {
	options.nintendo_ca_g3_path = path.resolve(options.nintendo_ca_g3_path);

	if (options.ca_private_key_path) {
		options.ca_private_key_path = path.resolve(options.ca_private_key_path);
	}

	if (options.site_private_key_path) {
		options.site_private_key_path = path.resolve(options.site_private_key_path);
	}

	if (options.csr_path) {
		options.csr_path = path.resolve(options.csr_path);
	}

	options.output_folder_path = path.resolve(options.output_folder_path);

	if (!fs.existsSync(options.nintendo_ca_g3_path)) {
		console.log(colors.bgRed('Invalid Nintendo CA - G3 path'));

		return false;
	}

	if (options.nintendo_ca_g3_format !== 'der' && options.nintendo_ca_g3_format !== 'pem') {
		console.log(colors.bgRed('Invalid Nintendo CA - G3 format: must be "der" or "pem"'));

		return false;
	}

	if (options.ca_private_key_path && !fs.existsSync(options.ca_private_key_path)) {
		console.log(colors.bgRed('Invalid CA private key path'));

		return false;
	}

	if (options.site_private_key_path && !fs.existsSync(options.site_private_key_path)) {
		console.log(colors.bgRed('Invalid site certificate private key path'));

		return false;
	}

	if (options.csr_path && !fs.existsSync(options.csr_path)) {
		console.log(colors.bgRed('Invalid CSR key path'));

		return false;
	}

	if (!fs.existsSync(options.output_folder_path)) {
		console.log(colors.bgRed('Invalid output folder path'));

		return false;
	}

	return true;
}

function forgeCertificateChain(options) {
	let nintendoCAG3;
	if (options.nintendo_ca_g3_format === 'pem') {
		const nintendoCAG3PEM = fs.readFileSync(options.nintendo_ca_g3_path);
		nintendoCAG3 = pki.certificateFromPem(nintendoCAG3PEM);
	} else {
		const nintendoCAG3DER = fs.readFileSync(options.nintendo_ca_g3_path, 'binary');
		const nintendoCAG3ASN1 = asn1.fromDer(nintendoCAG3DER);
		nintendoCAG3 = pki.certificateFromAsn1(nintendoCAG3ASN1);
	}

	let caPrivateKey;
	let caPublicKey;

	if (options.ca_private_key_path) {
		const privateKeyPEM = fs.readFileSync(options.ca_private_key_path);
		caPrivateKey = pki.privateKeyFromPem(privateKeyPEM);
		caPublicKey = pki.setRsaPublicKey(caPrivateKey.n, caPrivateKey.e);
	} else {
		const keyPair = pki.rsa.generateKeyPair(2048);

		caPrivateKey = keyPair.privateKey;
		caPublicKey = keyPair.publicKey;
	}

	const forgedCA = pki.createCertificate();

	forgedCA.publicKey = caPublicKey; 
	forgedCA.serialNumber = nintendoCAG3.serialNumber;
	forgedCA.validity.notBefore = nintendoCAG3.validity.notBefore;
	forgedCA.validity.notAfter = nintendoCAG3.validity.notAfter;
	forgedCA.setIssuer(nintendoCAG3.subject.attributes);
	forgedCA.setSubject(nintendoCAG3.subject.attributes);
	forgedCA.setExtensions([
		...nintendoCAG3.extensions.filter(({ name }) => name !== 'authorityKeyIdentifier'),
		{
			name: 'authorityKeyIdentifier',
			keyIdentifier: crypto.randomBytes(16).toString('ascii'),
			authorityCertIssuer: nintendoCAG3.issuer,
			serialNumber: nintendoCAG3.serialNumber
		}
	]);
  
	forgedCA.sign(caPrivateKey, md.sha256.create());

	let sitePrivateKey;
	let sitePublicKey;

	if (options.site_private_key_path) {
		const privateKeyPEM = fs.readFileSync(options.site_private_key_path);
		sitePrivateKey = pki.privateKeyFromPem(privateKeyPEM);
		sitePublicKey = pki.setRsaPublicKey(sitePrivateKey.n, sitePrivateKey.e);
	} else {
		const keyPair = pki.rsa.generateKeyPair(1024);

		sitePrivateKey = keyPair.privateKey;
		sitePublicKey = keyPair.publicKey;
	}

	let csr;

	if (options.csr_path) {
		const csrPEM = fs.readFileSync(options.csr_path);
		csr = pki.certificationRequestFromPem(csrPEM);
	} else {
		csr = pki.createCertificationRequest();
	}

	csr.publicKey = sitePublicKey;
	csr.setSubject([
		{
			name: 'commonName',
			value: options.common_name
		}
	]);
	csr.sign(sitePrivateKey);

	const siteCertificate = pki.createCertificate();

	siteCertificate.serialNumber = new Date().getTime().toString();
	siteCertificate.validity.notBefore = new Date();
	siteCertificate.validity.notAfter = new Date(); 
	siteCertificate.validity.notAfter.setDate(siteCertificate.validity.notBefore.getDate() + 3650);
	siteCertificate.setSubject(csr.subject.attributes);
	siteCertificate.setIssuer(forgedCA.subject.attributes);
	siteCertificate.publicKey = csr.publicKey;

	siteCertificate.sign(caPrivateKey, md.sha1.create());

	const chain = `${pki.certificateToPem(siteCertificate)}\n${pki.certificateToPem(forgedCA)}\n`;

	fs.writeFileSync(`${options.output_folder_path}/forged-ca.pem`, pki.certificateToPem(forgedCA), 'utf8');
	console.log(colors.green(`Wrote forged CA to ${options.output_folder_path}/forged-ca.pem`));

	fs.writeFileSync(`${options.output_folder_path}/forged-ca-private-key.pem`, pki.privateKeyToPem(caPrivateKey), 'utf8');
	console.log(colors.green(`Wrote forged CA private key to ${options.output_folder_path}/forged-ca-private-key.pem`));

	fs.writeFileSync(`${options.output_folder_path}/ssl-cert.pem`, pki.certificateToPem(siteCertificate), 'utf8');
	console.log(colors.green(`Wrote SSL certificate to ${options.output_folder_path}/ssl-cert.pem`));

	fs.writeFileSync(`${options.output_folder_path}/ssl-cert-private-key.pem`, pki.privateKeyToPem(sitePrivateKey), 'utf8');
	console.log(colors.green(`Wrote SSL certificate private key to ${options.output_folder_path}/ssl-cert-private-key.pem`));

	fs.writeFileSync(`${options.output_folder_path}/csr.csr`, pki.certificationRequestToPem(csr), 'utf8'); // TODO - Better name
	console.log(colors.green(`Wrote CSR to ${options.output_folder_path}/csr.csr`));

	fs.writeFileSync(`${options.output_folder_path}/cert-chain.pem`, chain, 'utf8');
	console.log(colors.green(`Wrote certificate chain to ${options.output_folder_path}/cert-chain.pem`));
}

main();
