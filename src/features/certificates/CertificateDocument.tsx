import 'server-only';

import { join } from 'node:path';
import QRCode from 'qrcode';
import React from 'react';

export type CertificatePdfInput = {
  learnerName: string;
  courseTitle: string;
  locale: 'vi' | 'en';
  issuedAt: string;
  serial: string;
  verificationUrl: string;
};

type DocumentProps = CertificatePdfInput & { qrDataUrl: string };

const CERTIFICATE_FONT = 'VFutureCertificate';
let fontsRegistered = false;

export async function renderCertificatePdf(input: CertificatePdfInput): Promise<Uint8Array> {
  // The renderer and its hyphenation dependency are ESM-only. A native dynamic
  // import keeps this path compatible with the CommonJS tsx seed entrypoint.
  const { Document, Font, Image, Link, Page, StyleSheet, Text, View, renderToBuffer } = await import('@react-pdf/renderer');
  if (!fontsRegistered) {
    Font.register({
      family: CERTIFICATE_FONT,
      fonts: [
        { src: join(process.cwd(), 'public/fonts/certificates/NotoSans-Regular.ttf'), fontWeight: 400 },
        { src: join(process.cwd(), 'public/fonts/certificates/NotoSans-Bold.ttf'), fontWeight: 700 },
      ],
    });
    fontsRegistered = true;
  }
  const styles = StyleSheet.create({
    page: {
      backgroundColor: '#f8fafc',
      color: '#172033',
      fontFamily: CERTIFICATE_FONT,
      padding: 44,
    },
    frame: {
      border: '2 solid #0f766e',
      height: 507,
      padding: 34,
      textAlign: 'center',
    },
    brand: { color: '#0f766e', fontSize: 13, letterSpacing: 3, marginBottom: 22 },
    title: { fontWeight: 700, fontSize: 28, marginBottom: 20 },
    lead: { color: '#526072', fontSize: 12, marginBottom: 10 },
    learner: { fontWeight: 700, fontSize: input.learnerName.length > 60 ? 17 : 25, marginBottom: 14 },
    course: { fontWeight: 700, fontSize: input.courseTitle.length > 65 ? 15 : 19, lineHeight: 1.3 },
    footer: { position: 'absolute', left: 34, right: 34, bottom: 28, alignItems: 'center', display: 'flex', flexDirection: 'row', justifyContent: 'space-between' },
    details: { color: '#526072', fontSize: 10, lineHeight: 1.6, textAlign: 'left' },
    verifyLink: { color: '#0f766e', textDecoration: 'underline', marginTop: 4 },
    qr: { height: 76, width: 76 },
  });
  const CertificateDocument = (props: DocumentProps) => {
    const vietnamese = props.locale === 'vi';
    const issuedDate = new Intl.DateTimeFormat(vietnamese ? 'vi-VN' : 'en-US', {
      year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Ho_Chi_Minh',
    }).format(new Date(props.issuedAt));
    return (
      <Document title={`${props.courseTitle} - ${props.learnerName}`} author="VFuture Academy">
        <Page size="A4" orientation="landscape" style={styles.page}>
          <View style={styles.frame}>
            <Text style={styles.brand}>VFUTURE ACADEMY</Text>
            <Text style={styles.title}>{vietnamese ? 'CHỨNG NHẬN HOÀN THÀNH' : 'CERTIFICATE OF COMPLETION'}</Text>
            <Text style={styles.lead}>{vietnamese ? 'Chứng nhận học viên' : 'This certifies that'}</Text>
            <Text style={styles.learner}>{props.learnerName}</Text>
            <Text style={styles.lead}>{vietnamese ? 'đã hoàn thành khóa học' : 'has successfully completed'}</Text>
            <Text style={styles.course}>{props.courseTitle}</Text>
            <View style={styles.footer}>
              <View style={styles.details}>
                <Text>{vietnamese ? 'Ngày cấp' : 'Issued'}: {issuedDate}</Text>
                <Text>{vietnamese ? 'Số chứng nhận' : 'Serial'}: {props.serial}</Text>
                <Text>{vietnamese ? 'Quét mã để xác minh' : 'Scan to verify'}</Text>
                <Link src={props.verificationUrl} style={styles.verifyLink}>{vietnamese ? 'Xác minh chứng nhận' : 'Verify certificate'}</Link>
              </View>
              {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf Image has no alt prop. */}
              <Image style={styles.qr} src={props.qrDataUrl} />
            </View>
          </View>
        </Page>
      </Document>
    );
  };
  const qrDataUrl = await QRCode.toDataURL(input.verificationUrl, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 256,
  });
  const buffer = await renderToBuffer(<CertificateDocument {...input} qrDataUrl={qrDataUrl} />);
  return new Uint8Array(buffer);
}
