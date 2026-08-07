unit HOSxPPCUAccount2LaborDetailFrameUnit;

interface

uses
  Windows, Messages, SysUtils, Variants, Classes, Graphics, Controls, Forms,
  Dialogs, DB, DBClient, cxGraphics, cxControls, cxLookAndFeels,
  cxLookAndFeelPainters, cxContainer, cxEdit, dxSkinsCore,
  dxSkinsDefaultPainters, Menus, cxSpinEdit, cxDBEdit, cxButtonEdit, StdCtrls,
  cxButtons, cxDropDownEdit, cxLookupEdit, cxDBLookupEdit, cxDBLookupComboBox,
  cxTextEdit, cxMaskEdit, cxCalendar, cxGroupBox, cxMemo;

{$RTTI EXPLICIT METHODS(DefaultMethodRttiVisibility) FIELDS(DefaultFieldRttiVisibility) PROPERTIES(DefaultPropertyRttiVisibility)}

type
  THOSxPPCUAccount2LaborDetailFrame = class(TFrame)
    PersonANCCDS: TClientDataSet;
    PersonANCDS: TDataSource;
    cxGroupBox1: TcxGroupBox;
    Label15: TLabel;
    cxDBDateEdit2: TcxDBDateEdit;
    Label16: TLabel;
    cxDBLookupComboBox1: TcxDBLookupComboBox;
    Label17: TLabel;
    cxDBLookupComboBox2: TcxDBLookupComboBox;
    Label21: TLabel;
    cxDBLookupComboBox3: TcxDBLookupComboBox;
    Label26: TLabel;
    cxDBLookupComboBox4: TcxDBLookupComboBox;
    cxButton9: TcxButton;
    Label27: TLabel;
    cxDBButtonEdit1: TcxDBButtonEdit;
    Label18: TLabel;
    cxDBSpinEdit1: TcxDBSpinEdit;
    Label19: TLabel;
    cxDBSpinEdit2: TcxDBSpinEdit;
    dxMemo: TcxMemo;
    cxButton1: TcxButton;
    procedure cxDBButtonEdit1PropertiesEditValueChanged(Sender: TObject);
    procedure cxButton9Click(Sender: TObject);
    procedure cxDBButtonEdit1PropertiesButtonClick(Sender: TObject;
      AButtonIndex: Integer);
    procedure cxButton1Click(Sender: TObject);
  private
    FPersonANCID: Integer;
    { Private declarations }
    procedure RefreshData;
    procedure SetPersonANCID(const Value: Integer);
  public
    { Public declarations }
    procedure SetPersonANCCDS(aCDS: TClientDataSet);
    property PersonANCID: Integer read FPersonANCID write SetPersonANCID;
  end;

implementation

uses HOSxPDMU, BMSApplicationUtil, HOSxPPCUAccount2DataModuleUnit;

{$R *.dfm}
{ THOSxPPCUAccount2LaborDetailFrame }

procedure THOSxPPCUAccount2LaborDetailFrame.cxButton1Click(Sender: TObject);
var
  an: string;
  cid: string;
  tc: TClientDataSet;
begin

  if (PersonANCCDS.State in [dsbrowse]) then
  begin
    if PersonANCCDS.RecordCount = 0 then
      PersonANCCDS.Append
    else
      PersonANCCDS.Edit;
  end;
  cid := vartostr(getsqldata('select cid from person where person_id = ' +
    inttostr(PersonANCCDS.fieldbyname('person_id').AsInteger)));

  try
    an := vartostr(getsqldata('select i1.an ' +
      ' from ipt_pregnancy i1 ,ipt i2,patient p,an_stat a ' +
      ' where i1.an = i2.an and a.an = i1.an and i2.hn = p.hn and p.cid = "' +
      cid + '" and i1.preg_number = ' + PersonANCCDS.fieldbyname('preg_no')
      .asstring +
      ' and i1.deliver_type > 0 and p.cid<>"1111111111111" and (a.pdx<>"" and a.pdx is not null) ')
      );
  except
    an := '';
  end;
  if an <> '' then
  begin

    tc := TClientDataSet.create(nil);
    tc.data := hosxp_getdataset('select * from ipt_pregnancy where an = "' +
      an + '"');
    if tc.RecordCount > 0 then
    begin

      PersonANCCDS.fieldbyname('labor_date').asdatetime :=
        tc.fieldbyname('labor_date').asdatetime;
      PersonANCCDS.fieldbyname('labor_place_id').AsInteger := 1;
      PersonANCCDS.fieldbyname('labor_doctor_type_id').AsInteger := 1;
      case tc.fieldbyname('deliver_type').AsInteger of
        1:
          PersonANCCDS.fieldbyname('labour_type_id').AsInteger := 1;
        2:
          begin
            case tc.fieldbyname('deliver_abnormal_type').AsInteger of
              0:
                PersonANCCDS.fieldbyname('labour_type_id').AsInteger := 2;
              1:
                PersonANCCDS.fieldbyname('labour_type_id').AsInteger := 4;
              2:
                PersonANCCDS.fieldbyname('labour_type_id').AsInteger := 3;
              3:
                PersonANCCDS.fieldbyname('labour_type_id').AsInteger := 5;
            end;
          end;
      end;

      PersonANCCDS.fieldbyname('labour_hospcode').asstring := fhospitalcode;
      // vartostr(getsqldata('select hospitalcode from opdconfig'));

      PersonANCCDS.fieldbyname('labor_icd10').asstring :=
        vartostr(getsqldata('select pdx from an_stat where an = "' + an + '"'));
      dxMemo.text := GetICD10NameByCode(PersonANCCDS.fieldbyname('labor_icd10')
        .asstring);

      PersonANCCDS.fieldbyname('alive_child_count').AsInteger :=
        tc.fieldbyname('child_count').AsInteger;
      PersonANCCDS.fieldbyname('dead_child_count').AsInteger :=
        tc.fieldbyname('dead_child_count').AsInteger;

    end;

    tc.free;

  end
  else
  begin
    showmessage('ไม่พบผลการคลอด');
  end;

end;

procedure THOSxPPCUAccount2LaborDetailFrame.cxButton9Click(Sender: TObject);
var
  s: string;
begin
  s := ExecuteRTTIFunction('HospitalCodeSearchFormUnit.THospitalCodeSearchForm',
    'DoShowForm', []).asstring;

  if s <> '' then
  begin
    if (PersonANCCDS.State in [dsbrowse]) then
    begin
      if PersonANCCDS.RecordCount = 0 then
        PersonANCCDS.Append
      else
        PersonANCCDS.Edit;
    end;

    PersonANCCDS.fieldbyname('labour_hospcode').asstring := s;

  end;
end;

procedure THOSxPPCUAccount2LaborDetailFrame.cxDBButtonEdit1PropertiesButtonClick
  (Sender: TObject; AButtonIndex: Integer);
var
  s: string;
begin
  s := ExecuteRTTIFunction('DiagnosisCodeSearchUnit.TDiagnosisCodeSearchForm',
    'DoShowForm', []).asstring;
  if s <> '' then
  begin
    if (PersonANCCDS.State in [dsbrowse]) then
    begin
      if PersonANCCDS.RecordCount = 0 then
        PersonANCCDS.Append
      else
        PersonANCCDS.Edit;
    end;

    PersonANCCDS.fieldbyname('labor_icd10').asstring := s;

    dxMemo.Lines.text := GetICD10NameByCode(s);

  end;
end;

procedure THOSxPPCUAccount2LaborDetailFrame.
  cxDBButtonEdit1PropertiesEditValueChanged(Sender: TObject);
begin
  dxMemo.Lines.text := GetICD10NameByCode(vartostr(cxDBButtonEdit1.EditValue));
end;

procedure THOSxPPCUAccount2LaborDetailFrame.RefreshData;
begin
  if not assigned(HOSxPPCUAccount2DataModule) then
    HOSxPPCUAccount2DataModule := THOSxPPCUAccount2DataModule.create
      (application);

  PersonANCCDS.data := hosxp_getdataset
    ('select * from person_anc where person_anc_id = ' +
    inttostr(FPersonANCID));

end;

procedure THOSxPPCUAccount2LaborDetailFrame.SetPersonANCCDS
  (aCDS: TClientDataSet);
begin
  PersonANCCDS.free;
  PersonANCCDS := aCDS;
  PersonANCDS.DataSet := PersonANCCDS;
end;

procedure THOSxPPCUAccount2LaborDetailFrame.SetPersonANCID
  (const Value: Integer);
begin
  FPersonANCID := Value;
  RefreshData;
end;

end.
